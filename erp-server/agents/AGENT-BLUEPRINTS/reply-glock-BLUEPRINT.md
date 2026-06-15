# REPLY GLOCK — Migration Blueprint (Python Port)

Workflow: **EVERTRUST - REPLY GLOCK** (`Vi9x1RhdRIaePZPQ`), project **REACH ARSENAL**.
Status: `active: false` at fetch time. Timezone `Europe/Berlin`. Error workflow: `qVvT6WLTYxtfubUg`.
This is the **reply-handling** counterpart to the outbound "REACH BAZOOKA" sender. It shares the same
Drive/Sheets layout, the same WhatsApp/LLM credentials, and (critically) the same `staticData` keys.

> The workflow file is a *merged* outbound+reply workflow: many nodes (Config — Globals, Build Activated,
> Compute Action, Schedule 8AM) referenced in code do NOT exist as nodes here — they're guarded with
> try/catch and are dead in this graph. Only the **replies** path is live. This blueprint documents the
> replies path; outbound-only branches are flagged as not-to-port.

---

## 1. Purpose & flow (node-by-node, replies path)

**Two trigger entry points feed `Config — Globals (Replies)`** (both currently `disabled`):
- `Schedule - Every 15 Min` (cron `*/15 * * * *`) — disabled
- `Webhook` (path `wf6-reply-glock`) — disabled

### Phase A — Campaign discovery (Drive)
1. `Config — Globals (Replies)` (Set) — emits run constants (see §12). `mode = "replies"`.
2. `Drive — Find Root Folder` — finds folder named `Evertrust Campaigns` (limit 1).
3. `Drive — List Campaign Folders` — lists all subfolders (campaigns) under root.
4. `Code — Build Run Start Message` — picks whichever globals node ran; builds `campaigns[]` = `{campaignFolderId, campaignName}` and a recon-sweep message body.
5. `Code — Explode Campaigns` — fan-out: one item per campaign carrying run constants.
6. `Loop — Campaigns` (splitInBatches) — **two outputs**:
   - **output 0 (done)** → `Code — Collect Active Labels` (the reply path proper)
   - **output 1 (loop body)** → `Drive — List Campaign Files`

### Phase B — Per-campaign config/leads load (loop body, output 1)
7. `Drive — List Campaign Files` → `Code — Check Required Files` — detects `config.json`, `leads*` sheet, `templates*` doc by filename; sets `allPresentStr`.
8. `IF — All Files Present`:
   - **true** → `Drive — Download config.json` → `Code — Parse config.json` → `Sheets — Read Leads` → `Code — Collect Leads` → `Drive — Download templates.doc` → `Code — Parse Template Blocks` → back to `Loop — Campaigns`.
   - **false** → `WA — Missing File Alert` → back to `Loop — Campaigns`.
   - **`Code — Collect Leads` writes `staticData.global.aggCampaigns[]`** (per-campaign config + leads). This is how the reply path later resolves a sender email → lead/campaign. THIS IS THE ONLY REASON the loop runs at all in replies mode.

### Phase C — Reply discovery (after loop, output 0)
9. `Code — Collect Active Labels` — reads `staticData.aggCampaigns`, builds the Gmail query (§3). **Fan-out to TWO Gmail accounts** (info + Hanna).
10. `Gmail — Get Replies` (info cred) → `Gmail — Hydrate Body` (get full message, `simple:false`).
    `Gmail — Get Replies (Hanna)` (Hanna cred) → `Gmail — Hydrate Body (Hanna)`.
11. Both hydrate nodes → `Code — Enrich Reply Context` — dedup, thread-collapse, lead-matching (§4).
12. `Code — Enrich Reply Context` → `Loop — Replies` (splitInBatches). **Two outputs**:
    - **output 0 (done)** → `Code — Aggregate Daily Counts` → `WA — Daily Summary`
    - **output 1 (loop body)** → `IF — Already Interested`

### Phase D — Per-reply routing (loop body)
13. `IF — Already Interested` (`currentStatus == "Interested"`):
    - **true** (this lead was already proposed slots last run; this reply is a slot pick) → `Code — Build Slot Pick Prompt` → `OpenAI — Parse Slot Choice` → `Code — Parse Slot Choice Response` → `IF — Slot Chosen`:
      - **true** → `Code — Meeting Fields` → `Calendar — Create Meeting` → `IF — Confirm Sender Hanna?` → send meeting confirmation (Hanna or info) → `Sheets — Set Meeting Scheduled` → `WA — Meeting Scheduled Notify` → `IF — MarkRead Sender Hanna?` → mark read → `Loop — Replies`.
      - **false** (ambiguous pick) → `Code — Build Classify Prompt` (falls through to fresh classification).
    - **false** (fresh reply) → `Code — Build Classify Prompt`.
14. `Code — Build Classify Prompt` → `OpenAI — Classify Reply` (DeepSeek) → `Code — Parse Classification` → `Switch — Route by Class` (3 outputs):
    - **output 0 `interested`** → `IF — Has Proposed Time?` (§6/§7)
    - **output 1 `unsure`** → `IF — Unsure Sender Hanna?` → auto-reply (Hanna/info) → `Sheets — Set Unsure Status` → `WA — Unsure Notify` → `IF — MarkRead Sender Hanna?` → mark read → `Loop — Replies`
    - **output 2 `notInterested`** → `Sheets — Set Not Interested` → `IF — MarkRead Sender Hanna?` → mark read → `Loop — Replies`

### Phase E — Interested → meeting (Switch output 0)
15. `IF — Has Proposed Time?` (`proposedStart` notEmpty):
    - **true** (lead named a time) → `Calendar — Check Proposed Window` → `Code — Resolve Proposed Slot` → `IF — Proposed Free?`:
      - **true** → `Code — Meeting Fields` → `Calendar — Create Meeting` → (confirmation/sheet/WA/markread as above).
      - **false** → `Calendar — Find Free Slots` (fall back to proposing 2 slots).
    - **false** (no time) → `Calendar — Find Free Slots`.
16. `Calendar — Find Free Slots` → `Code — Propose 2 Slots` (§7) → `AI Agent` (drafts email, §8) → `Code — Parse Agent's Response` → `IF — Proposal Sender Hanna?` → `Gmail — Send Slot Proposal (Hanna)` or `Gmail — Send Slot Proposal` (info) → `Sheets — Set Interested` → `WA — Interested Notify` → `IF — MarkRead Sender Hanna?` → mark read → `Loop — Replies`.

### Phase F — Error handler (separate trigger)
`On Workflow Error` → `Config Error Globals` → `Code Format Error Message` → `WA Error Alert`.

---

## 2. Triggers

- **`Schedule - Every 15 Min`** — scheduleTrigger, cron `*/15 * * * *`. **DISABLED.** Intended cadence: poll Gmail every 15 minutes.
- **`Webhook`** — path `wf6-reply-glock`. **DISABLED.** Manual/external kick.
- **`On Workflow Error`** — errorTrigger; fires on any node failure (this workflow is also its own error workflow target indirectly).

Both live triggers are disabled, so right now the workflow only runs manually. **Port intent: a 15-minute cron poller.** It does NOT receive Gmail push; it polls via Gmail search.

---

## 3. Reply discovery (HOW it finds new replies)

Built in **`Code — Collect Active Labels`**. The Gmail query is hardcoded (labels collected but NOT used in the query — see note):

```
is:unread newer_than:30d subject:Re: -from:calendar-notification@google.com -from:noreply@google.com -from:pictory.ai -from:activecampaign.com -from:otter.ai -from:read.ai -from:e.read.ai
```

- Polls **both** Gmail accounts (`Gmail — Get Replies` = info cred, `Gmail — Get Replies (Hanna)` = Hanna cred), same query, `readStatus: unread`.
- **It does NOT match against tracked thread IDs or labels to identify replies.** It relies purely on the heuristic `subject:Re:` + unread + last 30 days, minus a noreply/calendar blocklist. `activeLabels` is computed from `aggCampaigns[].config.gmailLabel` but is **never injected into the query** — dead computation.
- **How it knows a message is a reply to OUR outreach:** ONLY indirectly, in `Code — Enrich Reply Context`, by matching the `From` email against `aggCampaigns[].leads[].email`. If the sender isn't a known lead, the reply is still processed with `campaignName='unknown'`, `fallback:true` (NOT dropped). So the real "is this our lead" gate is **the leads sheet, matched by email** — NOT thread IDs and NOT the `outreachThreads` staticData map (which exists but is **not read** by this workflow — see §10).

### Dedup
- **`Code — Enrich Reply Context`** uses `staticData.global._processedReplyIds` (note the **leading underscore**). On each message: `if (sd._processedReplyIds[m.id]) continue;` then `sd._processedReplyIds[m.id] = Date.now();`
- There is ALSO a `staticData.global.processedReplyIds` (no underscore) populated by the outbound workflow — **this reply workflow does not read or write it.** Two separate maps.
- Secondary dedup: messages are collapsed **by threadId**, keeping only the newest message per thread (`byThread` Map keyed on `threadId || id`, comparing `internalDate`).
- Marking read (`Gmail — Mark Reply Read`) at the end of each branch is the OTHER dedup mechanism — next run's `is:unread` won't return it. Both must be preserved in the port.

---

## 4. Thread/context enrichment

There is **no full-thread fetch**. `Gmail — Hydrate Body` does `operation:get, simple:false` on the single message id to get headers + body parts. `Code — Enrich Reply Context` extracts the latest message per thread and its body. The "context" handed to the classifier is just: subject + the reply body text + lead/campaign metadata. No prior-message history is assembled.

**`Code — Enrich Reply Context` (verbatim, key logic):**

```js
function getBody(m) {
  try {
    if (m.text) return String(m.text);
    if (m.textPlain) return String(m.textPlain);
    const acc={plain:'',html:''};
    function walkParts(p){
      if(!p) return;
      if(p.mimeType==='text/plain' && p.body?.data) acc.plain += Buffer.from(p.body.data,'base64').toString('utf8');
      else if(p.mimeType==='text/html' && p.body?.data) acc.html += Buffer.from(p.body.data,'base64').toString('utf8');
      if(Array.isArray(p.parts)) p.parts.forEach(c=>walkParts(c));
    }
    walkParts(m.payload);
    return (acc.plain || acc.html.replace(/<[^>]+>/g,' ')).trim();
  } catch(e){ return ''; }
}
function getHeader(m,name){
  const h = m.payload?.headers?.find(h=>h.name?.toLowerCase()===name.toLowerCase());
  return h?.value || m[name] || '';
}

const sd = $getWorkflowStaticData('global');
sd._processedReplyIds = sd._processedReplyIds || {};
sd._outreachThreads = sd._outreachThreads || {};

const byThread = new Map();
for(const it of items){
  const m = it.json;
  const tid = m.threadId || m.id;
  const ts = Number(m.internalDate || Date.parse(m.date) || 0);
  const existing = byThread.get(tid);
  if(!existing || ts>Number(existing.internalDate || 0)) byThread.set(tid,m);
}

// per message:
const fromEmail = (getHeader(m,'From').match(/<([^>]+)>/)?.[1] || getHeader(m,'From')).trim();
const subject = getHeader(m,'Subject') || '';
const bodyText = getBody(m);
if(sd._processedReplyIds[m.id]) continue;
sd._processedReplyIds[m.id] = Date.now();

// lead match against aggCampaigns:
const campaignMatch = (sd.aggCampaigns||[]).find(c=> (c.leads||[]).some(l=>(l.email||'').toLowerCase()===fromEmail.toLowerCase()));
if(campaignMatch){
  const lead = campaignMatch.leads.find(l=>(l.email||'').toLowerCase()===fromEmail.toLowerCase());
  leadEmail = lead.email;
  campaignName = campaignMatch.campaignName || 'unknown';
  sender = /hanna/i.test(lead.sendFrom||'') ? 'hanna' : 'info';
}
```

Output item fields: `runId, today, managerWhatsAppNumber, senderPhoneNumberId, messageId, threadId, fromEmail, leadEmail, subject, replyText, matched, campaignName, sender, fallback`.

**IMPORTANT FIELD GAPS:** the enrich node does NOT emit `currentStatus`, `currentNotes`, `niche`, `city`, `project`, `companyName`, `companyType`, or `leadsFileId`. Downstream nodes reference those (e.g. `IF — Already Interested` reads `$json.currentStatus`; `Code — Build Classify Prompt` reads `$json.niche/city/project/companyName/companyType`; sheet writes read `$json.leadsFileId`). **These are all `undefined` in the live graph** — a real correctness gap (see §13). The Python port MUST source these from the leads row (`status`, `notes`, `companyName`, `companyType`) and from campaign config (`niche`, `city`, `project`), and carry `leadsFileId`.

---

## 5. Classification (THE COMPLETE LLM PROMPT, VERBATIM)

**Node `Code — Build Classify Prompt`** (`runOnceForEachItem`) builds the user prompt. `nowHuman` = `DateTime.now().setZone('Europe/Berlin')` formatted `EEE, dd LLL yyyy 'at' HH:mm`.

**System message** (in `OpenAI — Classify Reply`):
```
You are a reply classifier. Always respond with raw JSON only — no prose, no code fences.
```

**User prompt template (verbatim, `${...}` are JS interpolations):**
```
You are classifying a reply to a cold outreach email.

Campaign: ${d.niche} in ${d.city} — ${d.project}
Lead: ${d.companyName} (${d.companyType})
Their reply: ${d.replyText}

Today is ${nowHuman} (Europe/Berlin).

Classify "classification" as exactly one of: Interested, Unsure, Not Interested.
If and only if classification is "Not Interested", also set "niType":
- "temporary" = a soft no for now (busy, bad timing, no budget/project now, "maybe later", "circle back").
- "permanent" = a hard no / opt-out (stop contacting, remove us, unsubscribe, not relevant, do not contact).
When unsure between temporary and permanent, choose "temporary".
For Interested or Unsure, set "niType" to "".

If the lead proposes or requests a specific meeting date/time, set "proposedDateTime" to that moment as ISO 8601 with timezone offset (assume Europe/Berlin if none given), resolving relative phrases ("tomorrow 3pm", "next Tue morning") against today above. If no specific time is proposed, set "proposedDateTime" to "". Set "proposedRaw" to their exact wording (or "").

Return JSON only:
{
  "classification": "Interested" or "Unsure" or "Not Interested",
  "niType": "temporary" or "permanent" or "",
  "proposedDateTime": "ISO 8601 or empty",
  "proposedRaw": "their words or empty",
  "confidence": "high" or "low",
  "reasoning": "one sentence"
}
```

**Model / credential / params:**
- Node `OpenAI — Classify Reply` — `@n8n/n8n-nodes-langchain.openAi` v1.7, `modelId = "deepseek"`, `jsonOutput: true`, `temperature: 0.1`.
- Credential: **`LiteLLM Gateway (mac-mini)`** (`openAiApi`, id `2YgDmy9NuLHvOgzJ`). i.e. DeepSeek served via a self-hosted LiteLLM proxy on the mac-mini.

### EXACT classification + status vocabulary (shared contract)

The LLM returns one of three raw classifications:
- `Interested`
- `Unsure`
- `Not Interested`

`Code — Parse Classification` normalizes and DERIVES the leads-sheet **Status strings** actually written:

| LLM class | niType | Status written to sheet |
|---|---|---|
| `Interested` | "" | `Interested` (via Sheets — Set Interested), later `Meeting Scheduled` |
| `Unsure` | "" | `Unsure` |
| `Not Interested` | `permanent` | `Not Interested - Do Not Contact` |
| `Not Interested` | `temporary` | `Not Interested - Snoozed` **+ a date appended** (see below) |

Snooze: temporary → `niStatus = "Not Interested - Snoozed"`, `snoozeUntil = today + 60 days` (`YYYY-MM-DD`). The sheet write concatenates **`niStatus + snoozeUntil`** with NO separator, e.g. `Not Interested - Snoozed2026-08-09`. (Confirmed in staticData: existing sheet value `Not Interested - Do Not Contact`.)

**Complete set of Status strings this workflow can assign, verbatim:**
- `Interested`
- `Unsure`
- `Meeting Scheduled`
- `Not Interested - Do Not Contact`
- `Not Interested - Snoozed<YYYY-MM-DD>` (date directly appended, no space/delimiter)

Plus statuses it READS but does not assign (written by BAZOOKA): `Cold Outreached`, `NO_EMAIL`, `` (empty), and it special-cases `Interested` in `IF — Already Interested`.

`Code — Parse Classification` (verbatim, derivation):
```js
const c = (parsed.classification || '').trim();
const normalized = c === 'Interested' ? 'Interested' : (c === 'Not Interested' ? 'Not Interested' : 'Unsure');
let niType = '', niStatus = '', snoozeUntil = '';
if (normalized === 'Not Interested') {
  niType = ((parsed.niType || '').toString().trim().toLowerCase() === 'permanent') ? 'permanent' : 'temporary';
  if (niType === 'permanent') { niStatus = 'Not Interested - Do Not Contact'; }
  else {
    niStatus = 'Not Interested - Snoozed';
    const base = (lead.today || '').toString().slice(0, 10);
    const d0 = base ? new Date(base + 'T00:00:00Z') : new Date();
    snoozeUntil = new Date(d0.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  }
}
// proposed time honored only if Interested + parseable + in the future:
const dt = DateTime.fromISO(pdt, { zone: 'Europe/Berlin' });
if (dt.isValid && dt.toMillis() > DateTime.now().toMillis()) {
  proposedStart = dt.toISO();
  proposedEnd = dt.plus({ minutes: 30 }).toISO();
}
```

---

## 6. Routing per category

`Switch — Route by Class` (strict, caseSensitive) on `$json.classification`:

**`Interested` (output 0):**
- `IF — Has Proposed Time?` — if the lead named a concrete time → `Calendar — Check Proposed Window` (query that exact window) → `Code — Resolve Proposed Slot` (clash check vs external meetings) → `IF — Proposed Free?`:
  - free → book directly (`Code — Meeting Fields` → `Calendar — Create Meeting`).
  - busy → fall back to `Calendar — Find Free Slots` / propose 2 slots.
- No time → `Calendar — Find Free Slots` → `Code — Propose 2 Slots` → AI Agent drafts a slot-proposal email → send (Hanna/info) → **`Sheets — Set Interested` (Status `Interested`, Notes hold the slots)** → `WA — Interested Notify` → mark read.

**`Unsure` (output 1):**
- `IF — Unsure Sender Hanna?` → `Gmail — Send Unsure Auto-Reply (Hanna)` or `Gmail — Send Unsure Auto-Reply` (info). **Auto-sends a holding reply** (§8). → `Sheets — Set Unsure Status` (Status `Unsure`, Notes `Auto-holding reply sent — pending manual follow-up`) → `WA — Unsure Notify` (asks human to follow up) → mark read.

**`Not Interested` (output 2):**
- `Sheets — Set Not Interested` writes Status = `niStatus + snoozeUntil`. **No email reply sent, no delete.** Permanent → `Not Interested - Do Not Contact`; temporary → `Not Interested - Snoozed<date>`. → mark read. (Code comment: "Deleting a lead is irreversible, so only hard-stop on an explicit permanent signal." — nothing is ever deleted.)

**Already-Interested slot pick (pre-Switch, `IF — Already Interested` true):**
- Parse which slot they chose (`OpenAI — Parse Slot Choice`). If clear → book meeting (calendar + Meet link + confirmation email + `Sheets — Set Meeting Scheduled` (`Meeting Scheduled`) + `WA — Meeting Scheduled Notify`). If unclear → `WA — Slot Unclear` then mark read (no booking).

Summary of side effects per category:
| Category | Sheet Status | Email sent? | Calendar? | WhatsApp |
|---|---|---|---|---|
| Interested (no time) | `Interested` | Yes — slot proposal (AI-drafted, auto-sent) | reads free/busy | "Target acquired" |
| Interested (free time) | `Meeting Scheduled` | Yes — confirmation | creates event + Meet | "Direct hit — meeting booked" |
| Already Interested + clear pick | `Meeting Scheduled` | Yes — confirmation | creates event + Meet | "Direct hit" |
| Already Interested + unclear | (none) | No | No | "Target wobble — slot reply unclear" |
| Unsure | `Unsure` | Yes — holding auto-reply (auto-sent) | No | "Unsure reply — needs follow-up" |
| Not Interested (perm) | `Not Interested - Do Not Contact` | No | No | (none) |
| Not Interested (temp) | `Not Interested - Snoozed<date>` | No | No | (none) |

`WA — Daily Summary` fires once per run after the loop, **only if** interested>0 OR unsure>0 OR errors>0 (else returns `[]` and stays silent).

---

## 7. Slot proposal / booking

**`Code — Propose 2 Slots`** (after `Calendar — Find Free Slots`, which queries calendar `info@evertrust-germany.de`, `timeMin = now+1d startOfDay`, `timeMax = now+14d endOfDay`, orderBy startTime).

Logic:
- Window: next **14 calendar days**, **weekdays only** (`day.weekday <= 5`), business hours **09:00–17:00 Europe/Berlin**, **30-minute** slots stepping by 30 min.
- **Conflict rule (key):** only events with an **external** party block a slot. Internal-only events (attendee/organizer/creator all on `evertrust-germany.de` / `evertrust.de`) are IGNORED. Cancelled and `transparency: transparent` events ignored.
- Stops at **2 free slots**.
- Persists to `staticData.global.pendingSlots[fromEmail.toLowerCase()] = {slot1, slot2, proposedAt, project, companyName}`.

```js
const INTERNAL_DOMAINS = ['evertrust-germany.de', 'evertrust.de'];
const isExternal = (email) => { const d = domainOf(email); return !!d && !INTERNAL_DOMAINS.includes(d); };
const hasExternalParty = (j) => { /* attendees + organizer + creator emails */ return emails.some(isExternal); };
// skip cancelled / transparent / internal-only
const clash = busy.some(b => !(se <= b.start.toMillis() || ss >= b.end.toMillis()));
// human label: ...toFormat("EEE, dd LLL yyyy 'at' HH:mm") + (offset===120 ? ' CET' : ' CEST')
```
(Note the CET/CEST label is **inverted**: offset 120 min = +02:00 = CEST, but the code labels it `' CET'`. Bug — see §13.)

**Direct-time path — `Code — Resolve Proposed Slot`** (when lead named a time): re-checks the proposed window for external-party clashes (same rule); sets `proposedFree`, `chosenStart/End/Human`. `IF — Proposed Free?` → book or fall back.

**Booking — `Calendar — Create Meeting`** (googleCalendar v1.3):
- Calendar: `info@evertrust-germany.de` (hardcoded).
- `start = chosenStart`, `end = chosenEnd`.
- attendees: `[fromEmail, info@evertrust-germany.de]`; `conferenceSolution: hangoutsMeet` (auto Google Meet); `sendUpdates: all`; `guestsCanInviteOthers: false`.
- summary: `Evertrust GmbH × {{companyName}} — Intro Call`; description references `project`.

**Slot-pick parsing — `Code — Build Slot Pick Prompt` + `OpenAI — Parse Slot Choice`** (DeepSeek, temp 0.1, jsonOutput):
- Slots are recovered from the lead's **Notes column** via `::SLOTS::{json}::END::` marker (primary), falling back to `staticData.pendingSlots[fromEmail]`.

Slot-pick LLM **system message:**
```
You are a slot-confirmation parser. Always respond with raw JSON only — no prose, no code fences.
```
Slot-pick **user prompt (verbatim template):**
```
You are parsing a reply to a slot-proposal email.
The lead was offered:
Slot 1: ${slot1?.human || '(unknown)'} (start ${slot1?.start || ''})
Slot 2: ${slot2?.human || '(unknown)'} (start ${slot2?.start || ''})

Their reply: ${d.replyText || ''}

Return JSON only:
{
  "chosenSlot": 1 or 2 or null,
  "reasoning": "one sentence"
}
If they didn't clearly pick one of the two slots, set chosenSlot to null.
```

Notes recovery (verbatim):
```js
const m = notes.match(/::SLOTS::([\s\S]+?)::END::/);
if (m) { const data = JSON.parse(m[1]);
  if (data.s1Start) slot1 = { start: data.s1Start, end: data.s1End, human: data.s1Human };
  if (data.s2Start) slot2 = { start: data.s2Start, end: data.s2End, human: data.s2Human }; }
```

---

## 8. Draft / auto-reply generation

### Interested → slot-proposal email (AI-DRAFTED, AUTO-SENT)
Node `AI Agent` (`@n8n/n8n-nodes-langchain.agent` v3.1) with `OpenAI Chat Model` (DeepSeek via LiteLLM Gateway). **System message:**
```
You write the email yourself, in the voice of Hanna Nguyen at EVERTRUST GmbH. You are NOT filling in a template — you compose a fresh, human reply every time. Respond with raw JSON only, no prose, no code fences.
```
**User prompt (verbatim, `define` mode):**
```
Write Hanna's reply to a lead who just answered our cold outreach with interest. The reply proposes two meeting slots. Make it sound like a real person wrote it — never like a template.
CONTEXT:
- fromEmail: {{ $json.fromEmail }}
- leadEmail: {{ $json.leadEmail }}
- Subject: {{ $json.subject }}
- Company: {{ $json.companyName }}
- Their reply: {{ $json.replyText }}
- Campaign: {{ $json.niche }} in {{ $json.city }} — {{ $json.project }}
- Sender identity: {{ $json.sender || $('Code — Enrich Reply Context').item.json.sender || 'info' }}
VOICE — follow strictly:
- Decisive and warm, NEVER apologetic. Never use: "I'm sorry", "Sorry", "Unfortunately", "I'm afraid", "I hope this finds you well", "Please do not hesitate". No emojis.
- Open with genuine appreciation for their interest — register the person, don't just transact.
- Include exactly ONE specific, true detail pulled from their reply or the campaign ({{ $json.companyName }}, {{ $json.niche }}, {{ $json.city }}, or {{ $json.project }}). One real detail beats any pleasantry. Do not invent facts.
- Use "I would love to…" for the personal offer to take it further; "we" for company actions. Measured eagerness, never gushing. Treat them as a peer, never deferential.
- Short paragraphs (max 3 sentences), one blank line between, exactly one ask. Close facing forward.
LANGUAGE: Detect the language of their reply. If it is German, write the ENTIRE email in German; otherwise English.
SALUTATION: "Dear {{ $json.companyName }}," (English) or "Sehr geehrte Damen und Herren von {{ $json.companyName }}," (German).
REQUIRED — these must appear exactly, on their own lines (keep the slot text unchanged; translate only the instruction sentence if writing in German):
{{ $json.slot1Human }}
{{ $json.slot2Human }}
SIGN-OFF — match the sender identity above:
- If sender is "hanna": end with  Kind regards,<br>Hanna Nguyen<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>Hanna Nguyen<br>EVERTRUST GmbH)
- Otherwise: end with  Kind regards,<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>EVERTRUST GmbH)

OUTPUT — raw JSON only, no prose, no code fences:
{"bodyHtml": "<the full email as HTML, salutation through sign-off, using <br> for every line break>"}
The bodyHtml MUST literally contain "{{ $json.slot1Human }}" and "{{ $json.slot2Human }}". Output ONLY this field — the workflow re-attaches all lead data (email, messageId, sender, slots) automatically.
```
`Code — Parse Agent's Response` parses `{bodyHtml}` (strips code fences), falls back to raw text → `<br>`. Then **`Gmail — Send Slot Proposal` is `resource: draft`** — interestingly it creates a DRAFT (resource=draft, with `sendTo` option), NOT a reply send. Both info and Hanna variants use `resource: draft`. So the "interested" slot-proposal email is **staged as a Gmail draft addressed to the lead**, appending the Evertrust logo image. (Contrast: confirmation + unsure replies use `operation: reply` and ARE sent.)

### Unsure → holding auto-reply (TEMPLATED, AUTO-SENT)
`Gmail — Send Unsure Auto-Reply` (+Hanna), `operation: reply`, fixed body:
```
Dear {{companyName}},
Thank you for getting back to us. We have carefully gone through your concerns and are currently checking with our operations team to provide you with a complete answer as soon as possible.
We will follow up with you very shortly.
Best regards,
Evertrust GmbH
```
This **is sent automatically** (reply), then a WhatsApp tells the human to follow up manually. No human approval gate before sending.

### Meeting confirmation (TEMPLATED, AUTO-SENT)
`Gmail — Send Meeting Confirmation` (+Hanna), `operation: reply`, includes `chosenHuman` + Google Meet link.

**Approval model:** No WhatsApp approve/deny gate exists. WhatsApp messages are **notifications only**. The slot-proposal is staged as a draft (soft human gate — someone must hit send in Gmail); unsure holding-replies and meeting confirmations are auto-sent.

---

## 9. State WRITTEN

### Leads sheet (per campaign, `leadsFileId`, sheet `gid=0`, matched on `Email`)
- `Sheets — Set Interested`: `Status = "Interested"`, `Notes = "Slots proposed: {s1Human} | {s2Human} ::SLOTS::{json}::END::"` where json = `{s1Start,s1End,s1Human,s2Start,s2End,s2Human}`.
- `Sheets — Set Meeting Scheduled`: `Status = "Meeting Scheduled"`, `Notes = "Meeting at {chosenHuman} | Meet: {hangoutLink|pending}"`.
- `Sheets — Set Unsure Status`: `Status = "Unsure"`, `Notes = "Auto-holding reply sent — pending manual follow-up"`.
- `Sheets — Set Not Interested`: `Status = niStatus + snoozeUntil` (e.g. `Not Interested - Do Not Contact` or `Not Interested - Snoozed2026-08-09`). Also writes `row_number: 0` (likely a no-op artifact).

All four sheet nodes: `retryOnFail`, maxTries 3, wait 2s, `alwaysOutputData`, `onError: continueRegularOutput`.

### Notes markers written by THIS workflow
- `::SLOTS::{...}::END::` — embeds the two proposed slots in the lead's Notes (read back next run by `Code — Build Slot Pick Prompt`).
- (It does NOT write `::TID::` markers — see §10.)

### staticData keys written (names only)
- `global._processedReplyIds` (underscore) — dedup map `{messageId: ts}`.
- `global._outreachThreads` (underscore) — initialized to `{}` in enrich node but never populated by this workflow (dead).
- `global.pendingSlots` — `{leadEmailLower: {slot1, slot2, proposedAt, project, companyName}}`.
- `global.aggCampaigns`, `global.aggRunId` — written by `Code — Collect Leads` each run (campaign config + leads cache).

---

## 10. State READ (coupling with REACH BAZOOKA — CRITICAL for the Postgres port)

What this workflow ACTUALLY reads to do its job:

1. **Leads sheet `Status` column** — YES, load-bearing. `IF — Already Interested` branches on `currentStatus == "Interested"` (the status BAZOOKA/this workflow set last run) to decide "is this a slot-pick vs a fresh reply." (Bug: `currentStatus` is never populated by enrich — see §13 — but the *intent* is to read the sheet Status.) → **Postgres equivalent: `leads.status`.**
2. **Leads sheet `Notes` column** — YES. `Code — Build Slot Pick Prompt` reads `currentNotes` for the `::SLOTS::...::END::` marker to recover the two proposed slots. → **Postgres equivalent: the `notes`/slot-storage column or a `pending_slots` table.**
3. **Leads sheet rows (email, companyName, companyType, sendFrom)** — via `aggCampaigns` cache — used to (a) decide a reply is "ours" by email match, (b) pick Hanna-vs-info sender (`/hanna/i.test(sendFrom)`). → **Postgres: `leads` table by email; sender from a per-lead/campaign field.**

What it DOES **NOT** read (despite the keys existing in staticData):
- **`staticData.global.outreachThreads`** — present (a large `{email: [{threadId, messageId, sentAt, kind}]}` map written by BAZOOKA) but **NOT read anywhere in this workflow.** Reply identification is by `subject:Re:` + email match, not thread map.
- **`::TID::` markers** — searched for nowhere here. (Only `::SLOTS::` is used.)
- **`staticData.global.processedReplyIds`** (no underscore, BAZOOKA's) — not read; this workflow keeps its own `_processedReplyIds`.

**Coupling summary for the port (Postgres tables `leads`, `outreach_threads`):**
- HARD dependency: `leads.status` (the Interested/Cold Outreached/Meeting Scheduled/Not Interested* contract — see §5 vocabulary) and `leads.notes` (slot marker). Reply→lead linkage = **email match** against `leads`.
- The `outreach_threads(email, thread_id, message_id, kind)` table is **the obvious correct upgrade**: the Python port SHOULD link replies to outreach via `thread_id` (Gmail `threadId`) instead of the brittle `subject:Re:` heuristic — n8n had the data (`outreachThreads`) but never used it. `kind` values observed: `outreach`, `slotProposal`, `inferred`. `leads.thread_id` likewise lets you match the reply's `threadId` directly. **Recommend the port read `outreach_threads` by `thread_id` to confirm a reply is genuinely ours (and which campaign/lead), and fall back to email match.**

---

## 11. Credentials

| Credential (n8n name) | Type | id | Used by |
|---|---|---|---|
| Google Drive OAuth2 API | `googleDriveOAuth2Api` | 7ntqqDsIDCgae66w | Drive folder/file list + downloads |
| Google Sheets OAuth2 API | `googleSheetsOAuth2Api` | nVxTVzA6qeIhESvH | leads read + all status writes |
| Google Calendar OAuth2 API | `googleCalendarOAuth2Api` | Wljozop6BN5jIuhR | free/busy + create meeting |
| Gmail OAuth2 API | `gmailOAuth2` | hfmgCbneMAlU81I5 | **info** account: get/hydrate/reply/draft/markRead |
| Gmail account: Hanna | `gmailOAuth2` | iBJ8BCOqhFb5kDUg | **Hanna** account: get/hydrate/reply/draft/markRead |
| WhatsApp account | `whatsAppApi` | hfg64imhwFA01Qcb | all WA notifications |
| LiteLLM Gateway (mac-mini) | `openAiApi` | 2YgDmy9NuLHvOgzJ | DeepSeek for classify / slot-pick / AI agent |

Two Gmail identities (info + Hanna) are first-class: every Gmail action is duplicated and routed by an `IF — ... Sender Hanna?` on the lead's `sender` field.

---

## 12. Config consumed

### Run-level globals (`Config — Globals (Replies)`):
- `rootFolderName = "Evertrust Campaigns"` — Drive root to scan.
- `managerWhatsAppNumber = "84333634500"` — WA notification recipient.
- `errorAlertThreshold = 3` — (unused in replies path).
- `senderPhoneNumberId = "1030239273516528"` — WhatsApp Business phone number id (sender).
- `runId = {{ $now yyyy-LL-dd-HHmm }}`, `today = {{ $now yyyy-LL-dd }}`.
- `errorsSheetName = "Errors_Sheet"`, `errorsSheetId = "1ha4n6JG37e09kp6CuXBpDGp6uclqaK7XcbRBkor9YCw"` (declared, not used in replies path).
- `reviewEmailDefault = "marketing@evertrust.de"` (declared, unused here).
- `mode = "replies"` — branch selector.

### Per-campaign `config.json` (parsed in `Code — Parse config.json`; observed fields in staticData):
`niche, target, country, region, project, gmailLabel, salesCalendarId, whatsappNumber, sender`.
- `gmailLabel` — collected into `activeLabels` but **NOT used** in the Gmail query (dead).
- `salesCalendarId` — present (e.g. `info@evertrust-germany.de`) but the calendar nodes **hardcode** `info@evertrust-germany.de` rather than reading config. (Port should use `salesCalendarId`.)
- `sender` (`hanna`/`info`) — config-level default; actual routing uses per-lead `sendFrom`.
- `niche`, `project` — meant to feed the classify/draft prompts (but not wired through enrich — §13).
- `whatsappNumber` — per-campaign; NOT used (global `managerWhatsAppNumber` used instead).

### Leads sheet columns (from `Code — Collect Leads`):
`Company Name, Company Type, Email, Send From, Status, Date Sent, Notes` (+ `row_number`).

### templates.doc blocks (`Code — Parse Template Blocks`): `[COLD] [FOLLOWUP] [FINALPUSH]` with `Subject:`/`Body:` — **outbound only; not used in the reply path.**

---

## 13. Error handling & guards

- **Error workflow:** `On Workflow Error` → `Config Error Globals` → `Code Format Error Message` (formats wf name, failing node, message, execution URL `https://evertrustgmbh.app.n8n.cloud/...`) → `WA Error Alert` (WhatsApp "Weapon jammed"). Settings: `errorWorkflow: qVvT6WLTYxtfubUg`.
- **Sheet writes:** `retryOnFail`, maxTries 3, 2s backoff, `onError: continueRegularOutput`, `alwaysOutputData` — never hard-fail.
- **Gmail Hydrate Body:** retryOnFail 3×/2s, `onError: continueRegularOutput`.
- **Loud throws:** `Code — Collect Active Labels` / `Code — Build Run Start Message` / `Code — Aggregate Daily Counts` throw `'No globals node executed.'` if neither globals node ran. `Code — Parse config.json` throws on invalid JSON.
- **Enrich never returns empty:** if no reply matched, emits a single `matched:false` placeholder item (`messageId:'no-message'`) so downstream doesn't stall — the port should instead just emit zero items.

### Bugs / surprises to NOT replicate in the port
1. **Enrich drops most context fields.** `currentStatus, currentNotes, niche, city, project, companyName, companyType, leadsFileId` are referenced downstream but never set by `Code — Enrich Reply Context`. Result in the live graph: `IF — Already Interested` always false (slot-pick branch effectively dead unless status leaks in elsewhere); classify prompt says "Campaign: undefined in undefined — undefined / Lead: undefined (undefined)"; sheet writes use `leadsFileId = undefined` (writes silently no-op, swallowed by continueRegularOutput). **The Python port must hydrate these from leads/campaign.**
2. **`currentStatus` never populated** → `IF — Already Interested` is effectively always false; explicit slot-pick parsing path may never run; the workflow re-classifies slot replies from scratch.
3. **CET/CEST label inverted** in `Code — Propose 2 Slots` (offset 120 = CEST labeled CET).
4. **Slot proposal is a Gmail DRAFT, not a send** (`resource: draft`) — interested leads only get an email if a human opens Gmail and sends the draft, despite WA saying "Slots zeroed". Decide intended behavior in the port.
5. **`subject:Re:` discovery is brittle** (misses replies that strip "Re:", language variants like "AW:"/"RE:" subtleties, and doesn't tie to a real thread). Use `outreach_threads.thread_id` in the port.
6. **`activeLabels` and `salesCalendarId`/`whatsappNumber` config fields are computed but ignored**; calendar id and WA recipient are hardcoded.
7. **`niche`/`city`/`project`** — note `city` is never in config (config has `country`/`region`), so even with proper wiring `city` would be blank.

---

## 14. n8n artifacts NOT worth porting

- **`staticData` everywhere** — `aggCampaigns`, `pendingSlots`, `_processedReplyIds`, `_outreachThreads`, `outreachThreads`, `processedReplyIds`. Replace with Postgres: `leads`, `outreach_threads`, a `processed_reply_ids` table (or a `replied_at`/`processed` flag), and a `pending_slots` table or a JSON column.
- **`Loop — Campaigns` / `Loop — Replies` (splitInBatches)** + the `__sibReset` marker plumbing — replace with normal iteration.
- **The whole "merged outbound" half** — `Code — Build Run Start Message`, `Code — Explode Campaigns`, templates.doc parsing (`[COLD]/[FOLLOWUP]/[FINALPUSH]`), `Code — Check Required Files`, `Drive — Download config.json`, the try/catch hunts for the non-existent `Config — Globals` / `Build Activated` / `Compute Action` nodes. In a Python port the campaign config + leads come straight from Postgres; the Drive scan exists only to repopulate `aggCampaigns` for the email-match step.
- **`Code — Meeting Fields`** is `return items;` — a pure pass-through no-op.
- **`Sheets — Set Not Interested` `row_number: 0`** — artifact, drop.
- **`matched:false` placeholder item** in enrich — drop; emit zero rows.
- **Dual Gmail-identity duplication** (`IF — ... Sender Hanna?` + paired nodes) — in Python this is one send call with a `from`/account parameter chosen by `sender`.
- **Image logo `<img src="https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE">`** appended to outgoing mail — keep as a signature constant.
