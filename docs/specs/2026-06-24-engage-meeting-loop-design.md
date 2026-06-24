# Engage Meeting Loop — Propose → Accept/Counter → Book

**Status:** design (approved 2026-06-24) · **Surface:** Engage Reply Sorter, `reply_glock` agent, calendar
**Depends on:** the existing Propose Times + Book Meeting features; the `reach_aims.campaign_id` hand-off anchor.

## Goal

Close the scheduling loop in Engage so a proposed meeting time leads to a booked
meeting with one click, and a client **counter-proposal** is resolved against the
**real calendar** — book it if free, or auto-offer a nearby alternative if busy.

## Current state (what already exists)

- **Propose Times** — user picks free slots (`GET /engage/campaigns/:aimId/free-slots`),
  they're inserted into the draft and sent. The offered slots are **not remembered**.
- **Book Meeting** (`book-meeting-dialog.tsx` + `bookMeeting`) — a **manual** modal that
  derives a time from the reply text via a frontend heuristic (`deriveSlot`), then creates
  a calendar invite + Google Meet + an Activate `meetings` row.
- **`reply_glock`** — classifies a reply (INTERESTED/UNSURE/TEMPORARY/UNINTERESTED) + drafts a reply.
- **Gap:** nothing matches a client's acceptance back to the slots we offered, and a
  counter-proposed time isn't checked against the calendar.

## Decision

**One-click confirm** (not fully automatic): the scan detects the scheduling intent and
surfaces a pre-filled "Book it?" affordance; the human clicks once. This keeps a real
calendar invite from going out on a misread reply.

## Flow

1. **Propose.** User picks slots → Send. The exact offered slots are persisted on the
   reply (`proposed_slots`), `meeting_status = PROPOSED`.
2. **Client replies.** The next scan runs `reply_glock` (extended) which returns a
   **scheduling verdict**:
   - `accepted_index` — the client accepted one of the slots we offered, or
   - `counter_time` — the client asked for a specific time we did **not** offer, or
   - none — no scheduling signal.
3. **Resolve** (during the scan, after classify):
   - **(a) Accepted an offered slot** → `meeting_status = ACCEPTED`, `accepted_slot` =
     that slot (known-free, we offered it). Card: *"Client accepted Wed 24 Jun · 16:00 —
     Book it?"* → one-click book.
   - **(b) Counter-proposed a different time** → check the calendar (`freeBusy`) for that
     window:
     - **Free** → `meeting_status = ACCEPTED`, `accepted_slot` = the counter time. Card:
       *"Client wants Thu 15:00 — it's open. Book it?"* → one-click book.
     - **Busy** → compute free alternatives **near** the requested time; regenerate the
       draft reply to offer them (*"That slot's taken — would Thu 16:30 or Fri 10:00
       work?"*). `meeting_status = COUNTER`, new `proposed_slots`. Card: *"Client's time
       conflicts — alternatives drafted."* User reviews + sends → loops to step 1.
   - **(c) None** → existing behavior (no banner; manual Book Meeting still available).
4. **Book.** One click opens the existing `BookMeetingDialog`, **pre-filled with
   `accepted_slot`** (exact, not the heuristic guess). Booking creates the calendar
   invite + Meet + Activate `meetings` row, and — when the aim has a `campaign_id`
   (the eager-create follow-up) — links the meeting to that campaign. `meeting_status =
   BOOKED`, `booked_meeting_id` set. **Idempotent:** a BOOKED reply never re-surfaces.

## Data model

`reach_lead_replies` gains:

| Column | Type | Meaning |
|---|---|---|
| `proposed_slots` | `jsonb` | The slots we offered: `[{start,end}]`. Set on Propose-Times send / on a COUNTER round. |
| `meeting_status` | `text` | `NONE \| PROPOSED \| ACCEPTED \| COUNTER \| BOOKED` (default `NONE`). |
| `accepted_slot` | `jsonb` | The resolved slot to book `{start,end}` when `ACCEPTED`. |
| `booked_meeting_id` | `uuid → meetings.id` | Set when `BOOKED`; the CRM link + idempotency guard. |

## Components

- **Persist the offer** — when Propose Times sends, the frontend passes the full list of
  proposed slots; `sendReply` stores them in `proposed_slots` + sets `PROPOSED`.
- **Detect (agent)** — extend `reply_glock` (Python, `erp-agents`) to accept
  `proposed_slots` and return `{ accepted_index, counter_time, none }`. The scan persists
  the verdict on the reply.
- **Calendar check (counter)** — backend helpers on the calendar service:
  `isWindowFree(orgId, start, end)` (via `freeBusy`) and `alternativesNear(orgId, around)`
  (via `freeSlots`, filtered near the requested time).
- **Counter draft** — regenerate `draft_body` to propose the alternatives (templated or
  via `reply_glock`).
- **UI** — the reply card shows a banner keyed off `meeting_status`
  (ACCEPTED → "Book it?", COUNTER → "alternatives drafted", BOOKED → "✓ booked"); the
  one-click action reuses `BookMeetingDialog` pre-filled with `accepted_slot`.
- **Book → CRM link** — `bookMeeting` attaches the Activate `meetings` row to the aim's
  `campaign_id` when present.

## Edge cases

- Client asks for a time with **no prior proposed_slots** → treat as counter-proposed
  (calendar-check that time).
- **Idempotency** — `BOOKED` never re-surfaces; `ACCEPTED` never auto-re-books.
- **Ambiguous / none** → no banner; manual Book Meeting remains available.
- **Multiple counter-rounds** → each loop overwrites `proposed_slots` with the new offer.

## Dependencies & sequencing

- The **meeting → campaign** link needs `campaign_id` populated (the *eager-create a
  campaign per aim* follow-up). Until that lands, meetings book **unattributed** (as today)
  — this feature still works standalone.
- The `reply_glock` change is in the Python agent (`erp-agents`) — needs the agent
  restarted after the change.

## Out of scope (YAGNI)

- Fully automatic booking (the user chose one-click confirm).
- Multi-attendee / complex group availability.
- Cross-timezone negotiation beyond the org's `Europe/Berlin` default.
