# n8n → ERP run callback

How an n8n stage workflow reports an **autonomous run** back to the ERP so it shows
up in the Growth Engine **Live activity** feed (per campaign).

Without this, the ERP only logs runs *it* dispatched (the "Run now" buttons + the
daily scheduler). The actual stages (Lead Satellite, Ammo Forge, …) run on their
own inside n8n (Drive poll / cron) and were invisible to the ERP. This callback is
the missing **n8n → ERP writeback**.

> The sequence strip's live "RUNNING" dots come from the read-only executions
> poller. This callback is different: it records the **final outcome** of a run as
> a permanent row in the activity feed.

---

## Endpoint

```
POST  {ERP_API_BASE}/arsenal/runs/callback
Header:  x-arsenal-token: <ARSENAL_INGEST_TOKEN>
Header:  Content-Type: application/json
```

- **Auth** is the shared secret `ARSENAL_INGEST_TOKEN` (set in `infra/.env`) sent in
  the `x-arsenal-token` header. This is the **only** auth on the route — there is no
  JWT (n8n has no ERP session). Treat the token like a password.
- **Responses:** `202` `{ "ok": true, "id": "<runId>" }` on success ·
  `401` invalid/missing token · `503` token not configured on the server ·
  `404` the named campaign / Drive folder is unknown · `400` bad body.

### Body

| field          | required | notes |
|----------------|----------|-------|
| `stage`        | yes      | One of `LEAD_SATELLITE`, `AMMO_FORGE`, `REACH_BAZOOKA`, `REPLY_GLOCK`, `SLEEPER_GRENADE`. Case-insensitive (normalised to upper-case). |
| `status`       | yes      | `SUCCESS` or `ERROR` — the **final** outcome of the run. Case-insensitive. |
| `campaignId`   | no*      | The ERP campaign UUID, if the workflow knows it. |
| `driveFolderId`| no*      | The Google Drive folder id of the campaign — what n8n knows natively. The ERP resolves the campaign (and its org) from this. |
| `detail`       | no       | Short free-text (≤500 chars), e.g. `"12 leads scraped"` or an error message. |
| `metrics`      | no       | Flat map of funnel counts (≤20 keys, finite ≥0), e.g. `{ "emailsSent": 40 }`. Powers the **Marketing report** funnel/per-stage numbers. |

**`metrics` keys** (send what the stage knows): `leadsFound` (Lead Satellite) ·
`templatesForged` (Ammo Forge) · `emailsSent` (Reach Bazooka) · `repliesHandled`,
`meetingsBooked` (Reply Glock) · `leadsSwept` (Sleeper Grenade). Until a stage
sends these, the Marketing report shows that figure as "awaiting n8n".

To send `metrics` from the HTTP Request node, add a body field named `metrics`
whose value is an expression returning an object, e.g.
`={{ { emailsSent: $json.sentCount } }}` (keypair body), or switch the node to
**JSON body** mode and include `"metrics"` there.

\* **Per-campaign stages** (Lead Satellite, Ammo Forge) should send **either**
`campaignId` **or** `driveFolderId` so the run attaches to that campaign.
**Global stages** (Bazooka, Glock, Sleeper) send **neither** — they're recorded as
cross-campaign global runs.

Resolution order: `campaignId` first, else `driveFolderId`, else global.

---

## Networking

- **n8n Cloud** (`evertrustgmbh.app.n8n.cloud`) cannot reach `localhost` — the ERP
  API must be **publicly reachable** (a tunnel such as `cloudflared` / `ngrok`, or a
  deployed host). Use that public origin as `{ERP_API_BASE}`.
- **Self-hosted n8n** on the same Docker network can reach the API directly at
  `http://api:3001`.

---

## One-time setup

1. **Expose the API** (see Networking above) and note the public origin as
   `{ERP_API_BASE}`.
2. **Create the credential** once, reused by every stage: n8n →
   *Credentials → New → Header Auth* (Generic), **Name** `x-arsenal-token`,
   **Value** = the `ARSENAL_INGEST_TOKEN=` value from `infra/.env`. Save it as
   **"ERP Arsenal Ingest"**. Never paste the token inline in a node.

## Per-stage append map (verified against the live workflows)

Each row is where to attach the **HTTP Request** report-back node so it fires
**once** at the right moment. Append points already have wiring, so **draw the
connection manually** (a paste merges connections ambiguously) — except true
terminal nodes (noted), where a clipboard connection is fine.

| Stage | workflow id | httpReq ver | SUCCESS — wire FROM | campaign key (success) | ERROR — fork off |
|---|---|---|---|---|---|
| `LEAD_SATELLITE` | `fvilklqj7XAOLlLL` | 4.2 | `Append Leads Rows` *(terminal)* | `={{ $('Decide: Should Hunt?').first().json.campaignFolderId }}` | *(no error trigger — see below)* |
| `AMMO_FORGE` | `n2kA3j6uupUAe42A` | 4.4 | `Upload Template Doc` *(fork; keep loop-back to `Folder Loop`)* | `={{ $('Merge To Single Doc').first().json.campaignFolderId }}` | `On Workflow Error` |
| `REACH_BAZOOKA` | `qVvT6WLTYxtfubUg` | 4.2 | `Loop — Campaigns` **"done"** output | *(global — none)* | `On Workflow Error` |
| `REPLY_GLOCK` | `Vi9x1RhdRIaePZPQ` | 4.2 | `Code — Aggregate Daily Counts` *(fork)* | *(global — none)* | `On Workflow Error` |
| `SLEEPER_GRENADE` | `4GgPmoulQDgDWtej` | 4.2 | `Build Summary` *(fork)* | *(global — none)* | `On Workflow Error` |

Notes:
- **Per-campaign** stages (Lead Satellite, Ammo Forge) send `driveFolderId` — they
  carry no ERP `campaignId`, so the ERP resolves the campaign by its Drive folder.
- **Global** stages (Bazooka, Glock, Sleeper) send `status` only; the chosen append
  points fire exactly once per run and don't depend on the WhatsApp summary sending.
- **Lead Satellite has no error trigger.** Add a shared **Error Workflow** (an Error
  Trigger → one HTTP Request posting `status:"ERROR"`) and set it under each
  workflow's *Settings → Error Workflow*. The other four have an in-workflow
  `On Workflow Error` trigger you fork the ERROR node off directly.

## Template A — SUCCESS, per-campaign (Lead Satellite, Ammo Forge)

Paste, set **Authentication → Header Auth → "ERP Arsenal Ingest"**, replace
`{ERP_API_BASE}`, set `stage`, and set the `driveFolderId` expression from the table.
Use `typeVersion` `4.2` for Lead Satellite, `4.4` for Ammo Forge.

```json
{
  "parameters": {
    "method": "POST",
    "url": "{ERP_API_BASE}/arsenal/runs/callback",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "contentType": "json",
    "specifyBody": "keypair",
    "bodyParameters": {
      "parameters": [
        { "name": "stage", "value": "LEAD_SATELLITE" },
        { "name": "status", "value": "SUCCESS" },
        { "name": "driveFolderId", "value": "={{ $('Decide: Should Hunt?').first().json.campaignFolderId }}" },
        { "name": "detail", "value": "Run complete" }
      ]
    },
    "options": { "ignoreResponseCode": true }
  },
  "name": "ERP — Report Run",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [2600, 300]
}
```

## Template B — SUCCESS, global (Bazooka, Glock, Sleeper)

Same as A but no `driveFolderId`. Set `stage` per the table; `typeVersion` `4.2`.

```json
{
  "parameters": {
    "method": "POST",
    "url": "{ERP_API_BASE}/arsenal/runs/callback",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "contentType": "json",
    "specifyBody": "keypair",
    "bodyParameters": {
      "parameters": [
        { "name": "stage", "value": "REACH_BAZOOKA" },
        { "name": "status", "value": "SUCCESS" },
        { "name": "detail", "value": "Daily run complete" }
      ]
    },
    "options": { "ignoreResponseCode": true }
  },
  "name": "ERP — Report Run",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3000, 100]
}
```

## Template C — ERROR (fork off `On Workflow Error`)

Reports failures as **global** red entries (the error context carries no folder id).
Set `stage` per the table.

```json
{
  "parameters": {
    "method": "POST",
    "url": "{ERP_API_BASE}/arsenal/runs/callback",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "contentType": "json",
    "specifyBody": "keypair",
    "bodyParameters": {
      "parameters": [
        { "name": "stage", "value": "AMMO_FORGE" },
        { "name": "status", "value": "ERROR" },
        { "name": "detail", "value": "={{ $json.workflow.name }} failed at {{ $json.execution.lastNodeExecuted }}: {{ $json.execution.error?.message || 'run failed' }}" }
      ]
    },
    "options": { "ignoreResponseCode": true }
  },
  "name": "ERP — Report Error",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1200, 1400]
}
```

> Per the Arsenal error philosophy: report failures too. An `ERROR` callback turns
> the row red in the feed and tells the operator something broke. `ignoreResponseCode`
> keeps reporting best-effort — a callback hiccup never fails the real run.

---

## Quick test (from a machine that can reach the API)

```bash
TOK=$(grep -E '^ARSENAL_INGEST_TOKEN=' infra/.env | sed -E 's/^ARSENAL_INGEST_TOKEN=//')
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/arsenal/runs/callback \
  -H 'Content-Type: application/json' -H "x-arsenal-token: $TOK" \
  -d '{"stage":"ammo_forge","status":"success","driveFolderId":"<folderId>","detail":"manual test"}'
# -> {"ok":true,"id":"..."}  202
```

The run appears immediately under that campaign in **Growth Engine → Live activity**
(the feed polls every 15 s).
