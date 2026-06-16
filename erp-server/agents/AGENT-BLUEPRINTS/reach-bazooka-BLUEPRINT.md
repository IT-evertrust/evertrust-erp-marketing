# REACH BAZOOKA → Python: Analysis & Translation Plan

Source of truth for BEHAVIOR: n8n workflow `qVvT6WLTYxtfubUg` ("EVERTRUST — REACH BAZOOKA",
REACH ARSENAL project), fetched 2026-06-12. Workflow is currently **inactive** with both
triggers disabled — no parallel-run/double-send risk; the Python version replaces it directly.

**Data layer decision (2026-06-12):** the Drive-based campaign storage (folders, config.json,
leads Sheets, templates/news Docs) is being replaced by a **Postgres DB, built separately**.
The Python pipeline reads and writes Postgres only. Section 1 documents the n8n/Drive
behavior as the logic blueprint; section 2 is the Python design against Postgres; section 3
is the **data contract** the Postgres build must satisfy.

---

## 1. What the n8n workflow does (logic blueprint — unchanged)

Daily outbound cold-email engine over campaigns. One run =

```
8:00 Europe/Berlin (cron 0 8 * * *)
└─ Enumerate active campaigns
   └─ WA to manager: run started (N campaigns)
   └─ FOR EACH campaign:
      ├─ Load campaign config {niche, target, country, region, project, gmailLabel,
      │                         salesCalendarId, sender}
      ├─ Load leads: Company Name | Company Type | Email | Status | Date Sent | Notes
      ├─ Load templates: blocks [COLD] [COLD-AGG] [FOLLOWUP] [FINALPUSH],
      │                   each with Subject + Body
      ├─ Load news intel (optional; carries an isBadNews flag)
      ├─ incomplete campaign (no config/leads/templates) → WA "Mag jammed" alert, skip
      ├─ WA: "campaign hot, N rounds chambered"
      └─ FOR EACH lead:
         ├─ Email hygiene: unicode dashes→'-', strip nbsp/zero-width, trim
         ├─ COMPUTE ACTION (pure decision logic):
         │    invalid email                          → skip (INVALID_EMAIL)
         │    Status blank                           → cold
         │        variant: COLD-AGG if news isBadNews AND COLD-AGG block exists, else COLD
         │    Status "Cold Outreached" AND ≥2 days   → followup
         │    Status "Followed Up"    AND ≥4 days    → finalpush
         │    anything else                          → skip
         ├─ LLM PERSONALIZE+VALIDATE (model "deepseek" via LiteLLM gateway, temp 0.2):
         │    fills {{Company Name}} {{Company Type}} {{city}} {{project}};
         │    COLD-AGG: max ONE natural news-hook sentence, no arrow chains, no invention;
         │    returns JSON {valid, reason, finalSubject, finalBody}
         ├─ invalid → error log (Timestamp | Campaign | Lead Email | Step | Reason)
         └─ valid →
            ├─ SENDER ROUTING: sender contains "hanna" → Hanna Gmail, else info@.
            │    Body: \n→<br> + signature image, no attribution. Retry 3×/3s.
            ├─ TRACK THREAD: outreachThreads[email] += {threadId, messageId, sentAt,
            │    kind:'outreach'}   (consumed by Reply Glock to match replies)
            └─ UPDATE LEAD: Status → "Cold Outreached"/"Followed Up"/"Final Push",
                 Date Sent → today, thread id recorded (was "::TID::<id>::" in Notes)
   └─ Aggregate: cold/followup/finalpush/skipped/invalid → WA "Shots fired" summary
ERROR PATH: any failure → WA "Weapon jammed" alert with failing step + message.
```

Globals worth keeping: managerWhatsAppNumber `84333634500`, senderPhoneNumberId
`1030239273516528`, run id + today in Europe/Berlin. (errorAlertThreshold and
reviewEmailDefault were defined but never used — dropped.)

### Quirks in the n8n original (do NOT port)
- `__sibReset` loop marker, splitInBatches loop-back wiring, staticData aggregation —
  n8n loop workarounds; plain `for` loops.
- Triple-fallback base64/binary decoding — gone entirely with Drive.
- staticData leftovers (`pendingQueue`, `pendingSlots`, `processedReplyIds`) from the era
  when reply handling lived here.
- **Bug fixed by the move to Postgres:** sheet rows were updated by Email match, and real
  lead lists contain duplicate emails (`contact@sii.pl` twice in PL CYBERSECURITY) — wrong
  rows got stamped. In Postgres each lead has a primary key.
- **Gap fixed in the port:** no idempotency — a crash between Gmail send and the status
  update re-sent on retry. The `send_log` table closes this.

### Credentials (after the Postgres switch)
| Need | Python setup |
|---|---|
| Postgres | DSN in `.env` (provided by the DB build) |
| Gmail — info@ (default sender) | own GCP OAuth client, scope `gmail.send`; one-time consent flow |
| Gmail — hanna@ | second token, same client |
| WhatsApp | API key in `.env` — **confirm provider:** node config says Meta Cloud API (phoneNumberId), author note says 360dialog (`D360-API-KEY`) |
| LiteLLM Gateway (mac-mini) | `openai` SDK, `base_url` → gateway, model `deepseek` |

Drive + Sheets OAuth: **no longer needed at all.** Google setup shrinks to Gmail-send only.

---

## 2. Python design (Postgres-backed)

Standalone package now, shaped to slot into the future monorepo
(see LOCAL_AGENT_MIGRATION_PLAN.md). Sync code — a daily batch behind a 1-concurrent local
LLM gains nothing from asyncio.

```
bazooka/
├── pyproject.toml          # deps: psycopg[binary], google-api-python-client,
│                           #       google-auth-oauthlib, openai, httpx, pydantic, tenacity
├── .env                    # DATABASE_URL, WHATSAPP_API_KEY, LITELLM_BASE_URL/KEY
├── settings.py             # manager number, sender phone id, TZ — frozen dataclass
├── auth.py                 # Gmail OAuth: one-time consent flow, token cache per account
├── clients/
│   ├── gmail.py            # send_html(account, to, subject, body) -> (message_id, thread_id)
│   ├── whatsapp.py         # notify(text) — one POST; provider per .env
│   └── llm.py              # personalize(lead, template, ctx) -> Validation (pydantic),
│                           #   json-mode, temp 0.2, 2 retries then valid=False fail-safe
├── db.py                   # repository layer — ALL SQL lives here:
│                           #   fetch_active_campaigns(), fetch_leads(campaign),
│                           #   fetch_templates(campaign), fetch_news(campaign),
│                           #   mark_sent(lead, action, thread_id), log_error(...),
│                           #   already_sent_today(lead, action), record_run(...)
├── domain/
│   ├── models.py           # Campaign, Lead, Templates, Action, Validation
│   ├── hygiene.py          # clean_email(), is_valid_email()                    [pure]
│   └── actions.py          # compute_action(lead, today, news, templates)      [pure]
├── pipeline.py             # run(): campaigns -> leads -> action -> LLM -> send -> mark
├── cli.py                  # python -m bazooka [--live] [--campaign NAME] [--limit N]
└── tests/
    ├── test_hygiene.py     # U+2011 hyphen case etc. (the Gmail-rejection bug class)
    ├── test_actions.py     # full decision matrix (blank/2-day/4-day/skip/invalid)
    ├── test_db.py          # repository against a throwaway schema (or Neon branch)
    └── test_llm_canned.py  # the LLM AB HARNESS reborn: 5 canned leads through gateway
```

What disappeared vs. the Drive design: `gdrive.py`, `gsheets.py`, the template/news doc
parsers, the file-name detection logic, and the separate SQLite state store — pipeline state
(send log, threads, errors, runs) lives in the same Postgres.

### n8n node → Python mapping
| n8n node(s) | Python |
|---|---|
| Schedule 8AM Daily | launchd plist, `StartCalendarInterval` 08:00 |
| Drive find/list/download + all parsers | `db.py` SELECTs (4 queries per campaign max) |
| Code — Check Required Files | completeness check: campaign with no templates or zero leads → WA alert, skip |
| Loop — Campaigns / Loop — Leads / Explode / `__sibReset` | two nested `for` loops |
| Code — Compute Action | `domain/actions.py` — pure, fully unit-tested |
| Prepare LLM Payload + OpenAI node + Parse Validation | `llm.personalize()` — same prompt verbatim, pydantic-validated; parse failure ⇒ `valid=False` (matches current fail-safe) |
| IF — Sender Hanna? + 2 Gmail nodes | `gmail.send_html(account=...)` from `campaign.sender`; tenacity 3×/3s |
| Code — Track Outreach Thread (staticData) | `outreach_threads` table |
| Sheets — Update Status (`::TID::` in Notes) | `db.mark_sent()`: status + sent date + `thread_id` column in one transaction |
| Sheets — Log Error | `error_log` table |
| WA — * (5 nodes) | `whatsapp.notify()`, same message texts (Mag jammed, Shots fired, …) |
| On Workflow Error → WA | top-level `try/except` in `cli.py` → "Weapon jammed" + nonzero exit |
| Aggregate Outbound Counts | a `Counter` over the run, persisted to `runs` |

### Safety model (stricter than the n8n original)
1. **Dry-run is the default.** `python -m bazooka` produces the full fire plan — per lead:
   action, template block, LLM-personalized subject/body — written to `runs/<runId>.md`,
   WhatsApp messages printed not sent. No DB writes except a `runs` row marked `dry`.
   `--live` arms everything.
2. **Idempotency:** `send_log` has a unique constraint on (lead_id, action_type, sent_on);
   the send is recorded in the same transaction as the status update, checked before
   sending. A crash can't double-fire.
3. **`--limit N` / `--campaign NAME`** for supervised first live runs.
4. Loud failures: zero active campaigns, a campaign with leads but no templates, or an
   unreachable DB ⇒ raise + WhatsApp, never a silent no-op.

---

## 3. Data contract — what the Postgres build must provide

The pipeline is agnostic to where this DB runs; it just needs a DSN and this shape (names
negotiable, semantics not). **Read side** (owned by whoever populates campaigns — the
Ammo Forge / Lead Satellite successors):

```sql
campaigns (
  id          serial PRIMARY KEY,
  name        text NOT NULL,            -- e.g. 'PL CYBERSECURITY'
  active      boolean NOT NULL,         -- replaces "folder exists" as the run gate
  niche       text, target text, country text, region text, project text,
  sender      text NOT NULL DEFAULT 'info',  -- 'info' | 'hanna' (routing key)
  gmail_label text, sales_calendar_id text
)

leads (
  id           serial PRIMARY KEY,
  campaign_id  int REFERENCES campaigns NOT NULL,
  company_name text, company_type text,
  email        text,                    -- pipeline cleans/validates, never trusts
  status       text NOT NULL DEFAULT '',-- '' | 'Cold Outreached' | 'Followed Up'
                                        --    | 'Final Push' (+ Reply Glock's statuses)
  date_sent    date,
  thread_id    text,                    -- replaces the '::TID::<id>::' Notes hack
  notes        text
)

templates (
  campaign_id  int REFERENCES campaigns NOT NULL,
  block        text NOT NULL,           -- 'COLD' | 'COLD-AGG' | 'FOLLOWUP' | 'FINALPUSH'
  subject      text NOT NULL,
  body         text NOT NULL,           -- with {{Company Name}} etc. placeholders intact
  UNIQUE (campaign_id, block)
)

news_intel (                            -- optional per campaign; newest row wins
  campaign_id  int REFERENCES campaigns NOT NULL,
  body         text NOT NULL,
  is_bad_news  boolean NOT NULL DEFAULT false,  -- replaces regex over the doc text
  created_at   timestamptz NOT NULL DEFAULT now()
)
```

**Write side** (owned by the pipeline; can live in the same DB/schema):

```sql
send_log (
  id serial PRIMARY KEY,
  lead_id int NOT NULL, campaign_id int NOT NULL,
  action_type text NOT NULL,            -- 'cold' | 'followup' | 'finalpush'
  sent_on date NOT NULL,
  gmail_message_id text, gmail_thread_id text,
  UNIQUE (lead_id, action_type, sent_on)        -- the idempotency guard
)

outreach_threads (                       -- Reply Glock's future lookup table
  email text NOT NULL, thread_id text NOT NULL,
  message_id text, kind text NOT NULL DEFAULT 'outreach',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, thread_id)
)

error_log (ts timestamptz, campaign text, lead_email text, step text, reason text)

runs (run_id text PRIMARY KEY, started_at timestamptz, finished_at timestamptz,
      mode text,                         -- 'dry' | 'live'
      counts jsonb)                      -- {cold, followup, finalpush, skipped, invalid}
```

### Contract questions for the DB build (need answers before coding `db.py`)
1. **Templates: structured or raw?** Above assumes one row per block with subject/body
   already split. If the DB will instead store the raw templates-doc text, say so — I keep
   the `[BLOCK]`/Subject:/Body: parser from the Drive design (it's written and tested logic).
2. **Who sets `news_intel.is_bad_news`?** Currently inferred by regex over the news doc
   (`isBadNews: true` / `[BAD NEWS`). Cleanest if the Ammo Forge successor writes the flag;
   otherwise I port the regex.
3. **Status vocabulary ownership:** Reply Glock writes its own statuses ('Interested',
   'Not Interested - …', etc.) onto the same leads. Confirm `leads.status` stays a shared
   free-text column with the exact strings above, so the compute-action matrix keeps working.
4. **Migration of in-flight state:** ~200 threads are tracked in n8n staticData
   (`outreachThreads`) and `::TID::` markers in the live sheets. If Reply Glock should keep
   matching replies to already-sent outreach after the switch, that state needs a one-time
   import into `outreach_threads` / `leads.thread_id`. I can script the export from the
   workflow's staticData (already captured in this analysis).

### Dependency note
Until Reply Glock is ported to read Postgres, replies to Bazooka-sent mail will NOT be
matched: Reply Glock currently reads the leads **Sheets** and the old workflow's staticData,
both of which stop being updated. Recommended order: Bazooka goes live on Postgres →
Reply Glock port (reads `outreach_threads` + `leads`) follows immediately after.

### Build order (~2–3 working sessions, shorter than the Drive version)
1. **Contract + credentials** — agree section 3 with the DB build; Gmail consent flow for
   info@ + hanna@; WhatsApp key (confirm Meta vs 360dialog); smoke tests (DB round-trip,
   deepseek round-trip, WA test message).
2. **Decision engine + dry-run** — `db.py` read path, `compute_action`, unit tests green,
   full dry-run producing today's fire plan from the real DB. Zero risk, validates the port.
3. **LLM drafts in dry-run** — personalized subject/body in the run report for review;
   canned A/B test vs old gpt-4o outputs.
4. **Live path** — Gmail/WA/DB writes behind `--live`; first run
   `--live --campaign <test> --limit 3`; then full; then launchd at 08:00 and archive the
   n8n workflow.
