# Engage Meeting Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Engage scheduling loop — an offered slot the client accepts (or a counter-time they propose) is detected, calendar-checked, and surfaced as a one-click "Book it?" that reuses the existing Book Meeting flow.

**Architecture:** Persist the slots we offer on `reach_lead_replies`; the existing `reply_glock` scan returns a scheduling verdict (accepted slot / counter-time); the backend resolves it (accepted → ready to book; counter → calendar-check: free → ready to book, busy → re-draft alternatives); the reply card shows a status banner and a pre-filled one-click Book.

**Tech Stack:** NestJS + Drizzle (erp-server), Python/Pydantic agent (erp-agents `reply_glock`), Next.js (erp-client), Postgres. Backend tests: jest + real-Postgres Testcontainer. Agent tests: pytest. Frontend: manual verify.

**Reference spec:** `docs/specs/2026-06-24-engage-meeting-loop-design.md`

---

## File Structure

**Data model**
- Modify `packages/db/src/schema/engage-replies.ts` — add `proposedSlots`, `meetingStatus`, `acceptedSlot`, `bookedMeetingId` to `reachLeadReplies`.
- Create `packages/db/drizzle/0041_engage_meeting_loop.sql` — idempotent migration.

**Calendar (backend)**
- Modify `erp-server/src/google/google-calendar-read.service.ts` — add `isWindowFree()` + `alternativesNear()`.
- Test `erp-server/test/calendar-read.spec.ts` (new).

**Agent**
- Modify `erp-agents/src/erp_agents/workflows/engage/reply_glock/models.py` — add `SchedulingVerdict` + `scheduling` on input/output.
- Modify `.../reply_glock/prompts.py` + `workflow.py` — feed proposed slots, emit the verdict.
- Test `erp-agents/src/erp_agents/workflows/engage/reply_glock/tests/test_scheduling.py` (new, if a tests dir exists; else add to existing test module).

**Engage backend**
- Modify `erp-server/src/engage/engage.dto.ts` — send body carries the offered-slots list.
- Modify `erp-server/src/engage/engage-replies.service.ts` — persist offered slots on send; resolve the scheduling verdict in `scanCampaign`; expose meeting fields in `listReplies`; mark BOOKED.
- Modify `erp-server/src/engage/engage.controller.ts` — new `PATCH campaign-replies/:id/booked` (idempotent mark-booked + link).
- Test `erp-server/test/engage-meeting-loop.spec.ts` (new).

**Frontend**
- Modify `erp-client/src/modules/(growth)/engage/services/engage.service.ts` — pass offered slots on send; read meeting fields.
- Modify `erp-client/src/modules/(growth)/engage/types.ts` — meeting fields on `CampaignReply`.
- Modify `erp-client/src/modules/(growth)/engage/components/reply-detail.tsx` — status banner + pre-filled one-click Book.

---

## Task 1: Schema columns + migration

**Files:**
- Modify: `packages/db/src/schema/engage-replies.ts`
- Create: `packages/db/drizzle/0041_engage_meeting_loop.sql`
- Update: `packages/db/drizzle/meta/_journal.json`

- [ ] **Step 1: Add columns to `reachLeadReplies`** (after the existing `handled`/`sentAt` columns; match the file's existing import style — `jsonb`, `text`, `uuid`, `timestamp` are already imported there)

```ts
  // --- meeting loop (propose → accept/counter → book) ---
  // The slots we offered the client (set on a Propose-Times send / a COUNTER round).
  proposedSlots: jsonb('proposed_slots').$type<{ start: string; end: string }[]>(),
  // NONE | PROPOSED | ACCEPTED | COUNTER | BOOKED — drives the reply-card banner.
  meetingStatus: text('meeting_status').notNull().default('NONE'),
  // The resolved slot to book {start,end} when meetingStatus = ACCEPTED.
  acceptedSlot: jsonb('accepted_slot').$type<{ start: string; end: string }>(),
  // The Activate meeting created when BOOKED — CRM link + idempotency guard.
  bookedMeetingId: uuid('booked_meeting_id').references(() => meetings.id),
```

Add `import { meetings } from './meetings';` at the top if not already imported.

- [ ] **Step 2: Write the migration** `packages/db/drizzle/0041_engage_meeting_loop.sql`

```sql
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "proposed_slots" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "meeting_status" text NOT NULL DEFAULT 'NONE';--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "accepted_slot" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "booked_meeting_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_booked_meeting_id_meetings_id_fk" FOREIGN KEY ("booked_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 3: Append the journal entry** to `packages/db/drizzle/meta/_journal.json` (idx 41, tag `0041_engage_meeting_loop`, `when` = previous `when` + 1000, `version` "7", `breakpoints` true).

- [ ] **Step 4: Apply to the local DB** (the column may already need adding — idempotent)

Run:
```bash
cat packages/db/drizzle/0041_engage_meeting_loop.sql | sed 's/--> statement-breakpoint//g' | docker exec -i erp-postgres sh -c 'psql -U "$POSTGRES_USER" -d evertrust_finalized -v ON_ERROR_STOP=1'
```
Expected: `ALTER TABLE` ×4, `DO`.

- [ ] **Step 5: Rebuild dist + commit**

```bash
corepack pnpm --filter @evertrust/db build
git add packages/db/src/schema/engage-replies.ts packages/db/drizzle/0041_engage_meeting_loop.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): meeting-loop columns on reach_lead_replies"
```

---

## Task 2: Calendar helper — `isWindowFree`

**Files:**
- Modify: `erp-server/src/google/google-calendar-read.service.ts`
- Test: `erp-server/test/calendar-read.spec.ts`

`freeSlots` already builds a `freeBusy` request and computes free windows via `computeFreeSlots(busy, …)`. Reuse that internal busy-fetch; add a method that answers "is THIS window entirely free?".

- [ ] **Step 1: Write the failing test** — assert a window overlapping a busy block is not free, and a clear window is free. Mirror the existing `freeSlots` test setup in the file (use the same mailbox/token mock pattern already in `erp-server/test/` for google services; if none exists, stub `freeBusy` fetch).

```ts
// erp-server/test/calendar-read.spec.ts
import { computeWindowFree } from '../src/google/google-calendar-read.service';

describe('computeWindowFree (pure)', () => {
  const busy = [{ start: '2026-06-25T10:00:00Z', end: '2026-06-25T11:00:00Z' }];
  it('is false when the window overlaps a busy block', () => {
    expect(computeWindowFree(busy, '2026-06-25T10:30:00Z', '2026-06-25T11:30:00Z')).toBe(false);
  });
  it('is true when the window is clear', () => {
    expect(computeWindowFree(busy, '2026-06-25T12:00:00Z', '2026-06-25T12:30:00Z')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- calendar-read`
Expected: FAIL — `computeWindowFree` not exported.

- [ ] **Step 3: Implement** — export a pure helper next to `computeFreeSlots`, and a service method that fetches busy then calls it:

```ts
// pure, exported for tests
export function computeWindowFree(
  busy: { start: string; end: string }[],
  start: string,
  end: string,
): boolean {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return !busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return s < be && bs < e; // overlap
  });
}
```

```ts
// service method — reuse the same freeBusy fetch freeSlots uses (extract a private
// `fetchBusy(orgId, timeMin, timeMax)` from freeSlots if not already separate)
async isWindowFree(orgId: string, start: string, end: string): Promise<{ configured: boolean; free: boolean; reason: string | null }> {
  const busy = await this.fetchBusy(orgId, start, end); // returns { ok, busy[], reason }
  if (!busy.ok) return { configured: false, free: false, reason: busy.reason };
  return { configured: true, free: computeWindowFree(busy.busy, start, end), reason: null };
}
```

- [ ] **Step 4: Run test, verify pass.** Run: `corepack pnpm --filter @evertrust/api test -- calendar-read` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): isWindowFree"`

---

## Task 3: Calendar helper — `alternativesNear`

**Files:** Modify `erp-server/src/google/google-calendar-read.service.ts`; Test `erp-server/test/calendar-read.spec.ts`

- [ ] **Step 1: Failing test** — given the existing `freeSlots` result, `alternativesNear(around)` returns up to 3 free slots sorted by proximity to `around`.

```ts
import { pickNearest } from '../src/google/google-calendar-read.service';
it('picks the 3 slots closest to the requested time', () => {
  const slots = [
    { start: '2026-06-25T09:00:00Z', end: '2026-06-25T09:30:00Z' },
    { start: '2026-06-25T15:00:00Z', end: '2026-06-25T15:30:00Z' },
    { start: '2026-06-25T16:00:00Z', end: '2026-06-25T16:30:00Z' },
    { start: '2026-06-26T09:00:00Z', end: '2026-06-26T09:30:00Z' },
  ];
  const near = pickNearest(slots, '2026-06-25T15:15:00Z', 3);
  expect(near[0].start).toBe('2026-06-25T15:00:00Z');
  expect(near.length).toBe(3);
});
```

- [ ] **Step 2: Run → FAIL.** `corepack pnpm --filter @evertrust/api test -- calendar-read`

- [ ] **Step 3: Implement**

```ts
export function pickNearest(
  slots: { start: string; end: string }[],
  around: string,
  n: number,
): { start: string; end: string }[] {
  const a = new Date(around).getTime();
  return [...slots]
    .sort((x, y) => Math.abs(new Date(x.start).getTime() - a) - Math.abs(new Date(y.start).getTime() - a))
    .slice(0, n);
}
// service: alternativesNear(orgId, around) → freeSlots(orgId) then pickNearest(result.slots, around, 3)
async alternativesNear(orgId: string, around: string): Promise<{ start: string; end: string }[]> {
  const fs = await this.freeSlots(orgId);
  return fs.configured ? pickNearest(fs.slots, around, 3) : [];
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): alternativesNear"`

---

## Task 4: `reply_glock` scheduling verdict (agent)

**Files:**
- Modify `erp-agents/src/erp_agents/workflows/engage/reply_glock/models.py`
- Modify `.../reply_glock/prompts.py` and `.../reply_glock/workflow.py`
- Test `.../reply_glock/tests/test_scheduling.py`

- [ ] **Step 1: Add the verdict models** to `models.py`

```python
class SchedulingVerdict(BaseModel):
    # The client accepted one of the slots we offered (0-based into proposed_slots), or None.
    accepted_index: int | None = None
    # A specific time the client asked for that we did NOT offer (ISO-8601), or None.
    counter_time: str | None = None
```

Add to `ReplyGlockInput`:
```python
    # The slots we already offered this lead, so the agent can match an acceptance.
    proposed_slots: list[dict] = Field(default_factory=list)  # [{"start","end"}]
```
Add to `ReplyGlockOutput`:
```python
    scheduling: SchedulingVerdict = Field(default_factory=SchedulingVerdict)
```

- [ ] **Step 2: Failing test** `tests/test_scheduling.py` — drive the parse function (the bit that maps the model's JSON to `SchedulingVerdict`) with a synthetic LLM output: "the first option works" → `accepted_index == 0`; "can we do Thursday 3pm?" with no matching offer → `counter_time` set, `accepted_index is None`. If the agent is LLM-only with no pure parse seam, add a small pure `parse_scheduling(raw: dict, proposed_slots) -> SchedulingVerdict` and test that.

```python
from erp_agents.workflows.engage.reply_glock.models import parse_scheduling
def test_accepts_offered_slot():
    v = parse_scheduling({"accepted_index": 0, "counter_time": None}, [{"start":"x","end":"y"}])
    assert v.accepted_index == 0 and v.counter_time is None
def test_counter_time():
    v = parse_scheduling({"accepted_index": None, "counter_time": "2026-06-25T15:00:00Z"}, [])
    assert v.counter_time == "2026-06-25T15:00:00Z" and v.accepted_index is None
```

- [ ] **Step 3: Run → FAIL.** `cd erp-agents && .venv/bin/python -m pytest src/erp_agents/workflows/engage/reply_glock/tests/test_scheduling.py -q`

- [ ] **Step 4: Implement** `parse_scheduling` + wire it: extend the prompt (`prompts.py`) to include the offered slots and instruct the model to return `scheduling: {accepted_index, counter_time}` (accept by index if they reference one of the offered options; counter_time only for a concrete different time). In `workflow.py`, pass `input.proposed_slots` into the prompt and map the model JSON via `parse_scheduling` onto the output.

```python
def parse_scheduling(raw: dict, proposed_slots: list[dict]) -> SchedulingVerdict:
    idx = raw.get("accepted_index")
    if isinstance(idx, int) and 0 <= idx < len(proposed_slots):
        return SchedulingVerdict(accepted_index=idx, counter_time=None)
    ct = raw.get("counter_time")
    return SchedulingVerdict(accepted_index=None, counter_time=ct if isinstance(ct, str) and ct else None)
```

- [ ] **Step 5: Run → PASS, then restart the agent**

```bash
cd erp-agents && .venv/bin/python -m pytest src/erp_agents/workflows/engage/reply_glock/tests/test_scheduling.py -q
# restart the :8011 agent so the new output shape is live (see ops notes)
```

- [ ] **Step 6: Commit** — `git commit -am "feat(agent): reply_glock scheduling verdict"`

---

## Task 5: Persist the offered slots on send

**Files:** Modify `erp-server/src/engage/engage.dto.ts`, `erp-server/src/engage/engage-replies.service.ts`

- [ ] **Step 1:** Extend `campaignReplyBodySchema` (in `engage.dto.ts`) with the full offered set:

```ts
  // The full set of slots offered in this reply (so an acceptance can be matched).
  proposedSlots: z.array(proposedSlotSchema).max(10).optional(),
```

- [ ] **Step 2:** In `sendReply` (engage-replies.service.ts), when `proposedSlots?.length`, write them onto the reply row + set status:

```ts
if (proposedSlots?.length) {
  await this.db.update(schema.reachLeadReplies)
    .set({ proposedSlots, meetingStatus: 'PROPOSED', updatedAt: new Date() })
    .where(and(tenantScope(orgId, schema.reachLeadReplies), eq(schema.reachLeadReplies.id, replyId)));
}
```
Thread `proposedSlots` through the controller call (`engage.controller.ts:141` → pass `body.proposedSlots`) and the service signature.

- [ ] **Step 3:** Typecheck — `corepack pnpm --filter @evertrust/api typecheck` (ignore pre-existing `src/advanced/*`, `test/*`).
- [ ] **Step 4: Commit** — `git commit -am "feat(engage): persist offered slots on send"`

---

## Task 6: Resolve the scheduling verdict during the scan

**Files:** Modify `erp-server/src/engage/engage-replies.service.ts`; Test `erp-server/test/engage-meeting-loop.spec.ts`

Inject `GoogleCalendarReadService` (already injected as `this.calendar`). After `classifyAndDraft` returns `out` (which now carries `out.scheduling`), resolve before/within `upsertReply`.

- [ ] **Step 1: Failing test** — unit-test a pure `resolveScheduling(verdict, proposedSlots, calendar)` that returns the next meeting state. Use a fake calendar with `isWindowFree`/`alternativesNear`.

```ts
// accepted offered slot → ACCEPTED with that slot
// counter free → ACCEPTED with the counter slot
// counter busy → COUNTER with alternatives
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `resolveScheduling`:

```ts
type MeetingResolution =
  | { status: 'ACCEPTED'; acceptedSlot: { start: string; end: string } }
  | { status: 'COUNTER'; alternatives: { start: string; end: string }[]; counterTime: string }
  | { status: 'NONE' };

async resolveScheduling(
  orgId: string,
  verdict: { accepted_index: number | null; counter_time: string | null },
  proposedSlots: { start: string; end: string }[],
): Promise<MeetingResolution> {
  if (verdict.accepted_index != null && proposedSlots[verdict.accepted_index]) {
    return { status: 'ACCEPTED', acceptedSlot: proposedSlots[verdict.accepted_index] };
  }
  if (verdict.counter_time) {
    const end = new Date(new Date(verdict.counter_time).getTime() + 30 * 60_000).toISOString();
    const { free } = await this.calendar.isWindowFree(orgId, verdict.counter_time, end);
    if (free) return { status: 'ACCEPTED', acceptedSlot: { start: verdict.counter_time, end } };
    const alternatives = await this.calendar.alternativesNear(orgId, verdict.counter_time);
    return { status: 'COUNTER', alternatives, counterTime: verdict.counter_time };
  }
  return { status: 'NONE' };
}
```

- [ ] **Step 4:** Wire it in `scanCampaign` after classify: skip when the reply is already `BOOKED` (idempotency). On `ACCEPTED`, persist `meetingStatus='ACCEPTED'`, `acceptedSlot`. On `COUNTER`, set `meetingStatus='COUNTER'`, overwrite `proposedSlots` with the alternatives, and **regenerate the draft** to propose them (call the existing draft path with an instruction like `Propose these alternative times: …`; persist as `draftBody`). Wrap in try/catch — a scheduling failure must not fail the scan.

- [ ] **Step 5: Run → PASS.** `corepack pnpm --filter @evertrust/api test -- engage-meeting-loop`
- [ ] **Step 6: Commit** — `git commit -am "feat(engage): resolve scheduling verdict (accept/counter)"`

---

## Task 7: Expose meeting fields in `listReplies`

**Files:** Modify `erp-server/src/engage/engage-replies.service.ts`

- [ ] **Step 1:** Add to the `listReplies` row mapping: `meetingStatus`, `proposedSlots`, `acceptedSlot`, `bookedMeetingId` (read from `r`).
- [ ] **Step 2:** Typecheck. Commit — `git commit -am "feat(engage): expose meeting fields in reply list"`

---

## Task 8: Mark BOOKED + link the meeting to the campaign

**Files:** Modify `erp-server/src/engage/engage.controller.ts`, `erp-server/src/engage/engage-replies.service.ts`

The frontend books via `POST /growth/activate/meetings`. After a successful book it should tell Engage which reply was booked.

- [ ] **Step 1:** Add `PATCH /engage/campaign-replies/:id/booked` (campaigns:write, @OrgId) with body `{ meetingId: string }`. Service `markBooked(orgId, replyId, meetingId)`: set `meetingStatus='BOOKED'`, `bookedMeetingId=meetingId` (org-scoped, idempotent — no-op if already BOOKED). If the reply's aim has a `campaignId`, also `update meetings set campaign_id = <aim.campaignId> where id = meetingId` (org-scoped) so the call threads into the CRM.
- [ ] **Step 2:** Typecheck. Commit — `git commit -am "feat(engage): mark reply booked + link meeting to campaign"`

---

## Task 9: Frontend service + types

**Files:** Modify `erp-client/src/modules/(growth)/engage/services/engage.service.ts`, `.../engage/types.ts`

- [ ] **Step 1:** `CampaignReply` (types.ts) gains: `meetingStatus: 'NONE'|'PROPOSED'|'ACCEPTED'|'COUNTER'|'BOOKED'`, `acceptedSlot?: {start,end}`, `proposedSlots?: {start,end}[]`, `bookedMeetingId?: string`. Map them in `mapReply`.
- [ ] **Step 2:** `sendReply` already takes a single `proposedSlot`; add an optional `proposedSlots` arg and include it in the POST body (so the offered set is persisted). Add `markReplyBooked(replyId, meetingId)` → `PATCH /engage/campaign-replies/:id/booked`.
- [ ] **Step 3:** Typecheck — `corepack pnpm --filter @evertrust/web typecheck`. Commit.

---

## Task 10: Reply-card banner + one-click Book

**Files:** Modify `erp-client/src/modules/(growth)/engage/components/reply-detail.tsx`

- [ ] **Step 1:** When `reply.meetingStatus === 'ACCEPTED'`, render a banner: *"Client accepted {formatSlot(acceptedSlot)} — Book it?"* with a primary button that opens `BookMeetingDialog` pre-filled (`suggestedText` replaced by passing the exact `acceptedSlot` start as the dialog's date/time + 30 min). On a successful book, call `markReplyBooked(reply.id, meeting.id)` and toast "Meeting booked."
- [ ] **Step 2:** `COUNTER` → banner *"Client's time conflicts — alternatives drafted below, review & send."* (the draft body already holds the alternatives from Task 6). `BOOKED` → a calm *"✓ Meeting booked"* chip, hide the Book CTA.
- [ ] **Step 3:** When the user uses the existing Propose Times chips, pass the full set of inserted slots to `sendReply(..., proposedSlots)` (collect them in state instead of only the last).
- [ ] **Step 4:** Typecheck. Commit — `git commit -m "feat(engage): meeting-loop banner + one-click book"`

---

## Task 11: End-to-end verification (live local stack)

- [ ] **Step 1:** Restart the API + agent so the new agent output + backend are live (see ops notes in the session).
- [ ] **Step 2:** With auth temporarily off (or via the UI), scan the Cold Outreach Test campaign where granozita's reply accepts an offered slot → confirm `reach_lead_replies.meeting_status='ACCEPTED'` and `accepted_slot` set.
- [ ] **Step 3:** In the UI, confirm the "Book it?" banner appears pre-filled; book; confirm `meeting_status='BOOKED'`, `booked_meeting_id` set, and the meeting row's `campaign_id` populated (if the aim has one).
- [ ] **Step 4:** Counter-proposal path: seed/reply with a busy counter-time → confirm `meeting_status='COUNTER'` and the draft proposes alternatives.
- [ ] **Step 5:** Restore auth-on. Commit any fixes.

---

## Notes / dependencies

- **CRM link** is only populated when the aim has `campaign_id` (the separate *eager-create a campaign per aim* follow-up). Until then, the book still succeeds and the meeting stays unattributed — Task 8's `update meetings` is a no-op when `aim.campaignId` is null.
- **Agent restart required** after Task 4 (the :8011 dev agent must reload the new `ReplyGlockOutput` shape).
- **Multi-tenant:** every new query/write is org-scoped via `tenantScope`/`@OrgId` — verify in Tasks 5/6/8.
