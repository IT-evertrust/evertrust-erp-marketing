# Reach Auto-Sender — Design Spec

**Date:** 2026-06-24
**Branch:** finalized-erp
**Status:** Approved (design) — pending implementation

## Problem

The Reach "Bazooka" (the campaign auto-sender) is **manual-only and time-blind**:

- `runBazooka(orgId)` is invoked solely by the controller behind the **RUN BAZOOKA**
  button (`POST /growth/reach/bazooka/run`). No scheduler ever fires it.
- `eligibleLeads` has **no inter-round spacing** — a lead becomes due for the next
  round the instant the previous round is recorded. The only throttle is "one round
  per `runBazooka` call".
- The UI's **"Next send · Tomorrow 09:00"** is a hardcoded placeholder string
  (`reach.service.ts`: `… ? '-' : 'Tomorrow 09:00'`), not a computed time.

So a campaign cannot run hands-off: an operator must click the button, and even then
nothing enforces a humane cadence or a business-hours window. Naively bolting a timer
onto `runBazooka` today would blast cold → follow-up → final back-to-back.

## Goal

Make a campaign with auto-send **ON** progress on its own: send the cold round, then a
follow-up and a final at a configured cadence, only during business hours, and **only
while the lead hasn't replied** — fully org-scoped.

## Confirmed parameters

| Parameter | Value |
|---|---|
| Follow-up | **2 days** after the cold (outreach) send, if the lead hasn't replied |
| Final | **4 days** after the cold (outreach) send, if the lead hasn't replied |
| Send window | **09:00–17:00, Mon–Fri**, in each org's own timezone |
| Scheduler tick | **hourly** (`REACH_AUTOSEND_INTERVAL_MIN`, default 60), all orgs |
| Gating | only `reach_aims.auto_send = true` campaigns |

Both later rounds anchor to the **cold send** (not to the previous round). "Days" are
calendar days; the send-window gate defers the actual send to the next business slot,
so weekends are handled without weekday-counting.

## No schema change

Everything required already exists:
- `reach_sends.sent_at` (per round) and `reach_sends.replied_at`
- The reply signal: Engage's `propagateClassification → markLeadReplied` stamps
  `reach_sends.replied_at` on the lead's **latest send** (it does NOT touch
  `reach_leads.replied_at`). So "the lead replied" = **any** of its `reach_sends` rows
  has `replied_at` set. (`reach_leads.status` is also updated for mapped categories, but
  not all replies map a status, so the send-level flag is the reliable gate.)
- per-org sales timezone (migration `0034_org_sales_timezone`)

## Design — four changes

### 1. Spacing + reply-stop in `eligibleLeads` (`reach.repository.ts`)

The core logic. A `ROUND_DELAY_DAYS` map (`cold: 0, followup: 2, final: 4`) anchored to
the cold send. A lead is eligible for a round when:

- `cold` → never sent cold
- otherwise → lead **has not replied** (no `reach_sends` row for the lead has
  `replied_at` set), the round was not already sent, and the cold send was
  **≥ `ROUND_DELAY_DAYS[round]` days ago**

`eligibleLeads` already queries the lead's `reach_sends` rows (to check `has(round)` and
the cold `sent_at`), so the reply-stop is one extra column on that same select —
`replied_at` — gated with `sends.some(s => s.leadId === id && s.repliedAt !== null)`. No
second query, no `reach_leads` change. Return shape (`{id, company, email}`) is unchanged.

**Round ordering is free:** `nextDueRound` already scans `cold → followup → final` and
returns the first round with eligible leads, so a still-due follow-up is always picked
before final — no explicit "follow-up before final" prerequisite is needed. In the rare
catch-up case (campaign re-enabled after day 4) follow-up sends on one tick and final on
the next (~1h apart), never the same tick.

### 2. Send-window helper (`reach-window.ts`)

Pure, dependency-free, unit-testable:

```ts
isWithinSendWindow(now: Date, timeZone: string): boolean  // Mon–Fri, 09:00–17:00, org tz
nextWindowOpen(now: Date, timeZone: string): Date          // for the "next send" display
```

Uses `Intl.DateTimeFormat({ timeZone })` to read the org's local wall-clock — correct
across DST, no new dependency.

### 3. `ReachScheduler` (`reach-scheduler.service.ts`)

A carbon copy of `engage-scheduler.service.ts`'s dependency-free, self-rescheduling,
restart-safe timer (`OnModuleInit`/`OnModuleDestroy`, `setTimeout` re-armed **after** the
run finishes, first run delayed one interval). Each tick loops every org and, **only when
`isWithinSendWindow` for that org**, calls `runBazooka(org.id)`. A failing tick is logged
and never kills the loop. Registered in the Reach module providers.

**Separation of concerns:**
- Window gate lives in the scheduler → the **manual RUN BAZOOKA button bypasses the
  window** (operator intent = "send now").
- Spacing + reply-stop live in `eligibleLeads` → enforced on **every** path, manual
  included (they protect the prospect, not the operator).
- `runBazooka` itself is **unchanged** — it inherits the smarter `eligibleLeads`.

### 4. Real "Next send" (replaces the placeholder)

`nextSendAt(orgId, aimId, timeZone)` = the soonest `coldSentAt + ROUND_DELAY_DAYS[nextRound]`
across not-yet-replied leads, clamped forward to `nextWindowOpen`. Surfaced through the
campaign-list API so the UI shows a real date/time instead of `'Tomorrow 09:00'`.

## Multi-tenancy (non-negotiable)

The scheduler iterates orgs; timezone, send window, sender mailbox, and creds resolve
**per-org** (`org value ?? env default`). `runBazooka` is already org-scoped and
`tenantScope`d. No cross-org leakage; `OWNER` is the only cross-org role.

## Testing (real-DB jest, mirrors existing reach / engage-scheduler specs)

- **Spacing:** follow-up not eligible at cold + 1 day; eligible at cold + 2; final at + 4.
- **Reply-stop:** a lead with `replied_at` set is excluded from follow-up and final.
- **Round order:** with both follow-up and final past-due, `nextDueRound` returns follow-up.
- **Window:** `isWithinSendWindow` false at 18:00, on Saturday, and across a DST boundary;
  true at Tue 10:00.
- **Scheduler:** arms on init, re-arms after a tick, skips orgs outside their window, a
  throwing tick doesn't stop the loop.
- **Next send:** computes the expected clamped instant for a campaign mid-sequence.

## Out of scope

- Per-org daily send caps / rate limiting (note for a later deliverability pass).
- Configurable-per-org cadence/window (hardcoded constants now; lift to org config later).
- Changing the manual button's behavior beyond inheriting the new spacing/reply-stop.
