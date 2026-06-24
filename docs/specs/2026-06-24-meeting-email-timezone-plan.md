# Meeting-Email Time Grounding + Timezone — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every meeting-booking reply email states the **exact booked slot time** (rendered from the structured `proposed_slots` / `accepted_slot`, never written by the LLM) **with the org's timezone** — primary CET/CEST (GMT+2) and a GMT+7 cross-reference — so the email time always matches the calendar invite.

**Rule (from the user):** "every meeting booking email must follow with org's timezone (CET/CEST / GMT+2), and the time must be precise."

## Root cause (verified against live data)

granozita's `accepted_slot` = `2026-06-25T07:30:00Z` = **09:30 GMT+2 = 14:30 GMT+7** (matches the calendar). But `draft_body` says *"Tuesday afternoon"* and the sent email says *"17:45"* — an LLM invention that matches neither zone. The email's time is free-text, decoupled from the structured slot. Specifics:

- `applyScheduling` **ACCEPTED** branch does NOT regenerate the draft → the stale invented time ships in the confirmation. (`engage-replies.service.ts` ~378–391)
- **COUNTER** branch passes raw ISO strings in a free-text instruction (`'…Propose these alternative times instead: 2026-07-02T09:00:00.000Z – …'`) → the LLM reformats and invents. (~426–433)
- The drafter prompt (`erp-agents/.../reply_glock/prompts.py` `DRAFT_SYSTEM_PROMPT`) never receives the slot or a timezone.
- `createEvent` hardcodes `timeZone: 'Europe/Berlin'` instead of the org's resolved zone. (`engage-replies.service.ts` ~1273)
- `resolveOrgTimeZones(orgId): {primary, secondary}` exists but is **private** in `google-calendar-read.service.ts` (~358); no dual-zone human formatter exists anywhere.

Org config already has the zones: Evertrust `salesTimeZone` = blank → defaults `Europe/Berlin` (GMT+2); `salesSecondaryTimeZone` = `Asia/Bangkok` (GMT+7). The calendar already renders both correctly — only the email is wrong.

## Design — deterministic, not LLM-trusted

1. **A pure dual-zone formatter** renders a slot (or slots) into a labelled time block from the org's primary+secondary IANA zones.
2. **The system owns the time**: the meeting-booking email body always carries a system-rendered time block (idempotent, marker-delimited). The **LLM is instructed to never state a date/clock time** — it refers to "the time below". This guarantees email == calendar forever.
3. Applied at all three meeting-booking points — **PROPOSED** (sendReply), **ACCEPTED** (confirmation normalize), **COUNTER** (alternatives) — plus the `createEvent` timezone is org-resolved.

Existing drafts are not retroactively rewritten; the rule applies to newly drafted/sent meeting emails ("from now on").

---

## Task 1: Dual-zone meeting-time formatter (pure util)

**Files:**
- Create: `erp-server/src/engage/meeting-time-format.ts`
- Test: `erp-server/test/meeting-time-format.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// erp-server/test/meeting-time-format.spec.ts
import { formatMeetingTimeBlock } from '../src/engage/meeting-time-format';

const SLOT = { start: '2026-06-25T07:30:00.000Z', end: '2026-06-25T08:00:00.000Z' }; // 09:30–10:00 Berlin

describe('formatMeetingTimeBlock', () => {
  it('renders one slot in primary tz with a GMT+7 cross-reference', () => {
    const out = formatMeetingTimeBlock([SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    expect(out).toContain('Thursday, 25 June 2026');
    expect(out).toContain('09:30');           // primary local time
    expect(out).toContain('GMT+2');           // primary offset label
    expect(out).toContain('14:30');           // GMT+7 cross-reference time
    expect(out).toContain('GMT+7');           // secondary offset label
  });

  it('omits the cross-reference when there is no secondary zone', () => {
    const out = formatMeetingTimeBlock([SLOT], 'Europe/Berlin', null);
    expect(out).toContain('09:30');
    expect(out).toContain('GMT+2');
    expect(out).not.toContain('GMT+7');
  });

  it('lists each slot on its own line when several are proposed', () => {
    const out = formatMeetingTimeBlock(
      [SLOT, { start: '2026-06-26T13:00:00.000Z', end: '2026-06-26T13:30:00.000Z' }],
      'Europe/Berlin',
      'Asia/Bangkok',
    );
    expect(out.trim().split('\n').length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('25 June 2026');
    expect(out).toContain('26 June 2026');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern meeting-time-format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// erp-server/src/engage/meeting-time-format.ts
// Deterministic, dependency-free rendering of meeting slots for client emails. The
// slot is an absolute instant (ISO-8601 UTC); we render it in the org's PRIMARY zone
// (e.g. Europe/Berlin → CET/CEST, GMT+2) with a SECONDARY cross-reference (e.g.
// Asia/Bangkok → GMT+7). This is the single source of truth for the time a client sees;
// it must equal the calendar invite, so it is rendered from the SAME slot the booking uses.

export type Slot = { start: string; end: string };

function parts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'), day: get('day'), month: get('month'), year: get('year'),
    hour: get('hour'), minute: get('minute'),
    offset: get('timeZoneName').replace('GMT', 'GMT'), // e.g. 'GMT+2'
  };
}

function hm(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p.hour}:${p.minute}`;
}

// One human line for a slot, e.g.:
// "Thursday, 25 June 2026, 09:30–10:00 (GMT+2) · 14:30–15:00 (GMT+7)"
function formatSlot(slot: Slot, primaryTz: string, secondaryTz: string | null): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const p = parts(start, primaryTz);
  let line =
    `${p.weekday}, ${p.day} ${p.month} ${p.year}, ` +
    `${hm(start, primaryTz)}–${hm(end, primaryTz)} (${p.offset})`;
  if (secondaryTz) {
    const s = parts(start, secondaryTz);
    line += ` · ${hm(start, secondaryTz)}–${hm(end, secondaryTz)} (${s.offset})`;
  }
  return line;
}

export function formatMeetingTimeBlock(
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
): string {
  return slots.map((s) => formatSlot(s, primaryTz, secondaryTz)).join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern meeting-time-format`
Expected: PASS (3 tests). (`shortOffset` yields `GMT+2`/`GMT+7` on the project's Node.)

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/engage/meeting-time-format.ts erp-server/test/meeting-time-format.spec.ts
git commit -m "feat(engage): dual-zone meeting-time formatter (primary + GMT+7 cross-ref)"
```

---

## Task 2: Public org-timezone accessor

**Files:**
- Modify: `erp-server/src/google/google-calendar-read.service.ts` (expose the resolver)
- Test: extend `erp-server/test/calendar-read.spec.ts` (or the closest calendar spec)

- [ ] **Step 1: Write the failing test**

```ts
// add to calendar-read.spec.ts
it('exposes org timezones publicly (org override + default fallback)', async () => {
  const svc = makeService(); // existing helper in this spec
  const tz = await svc.getOrgTimeZones('00000000-0000-0000-0000-000000000000'); // unseeded org
  expect(tz.primary).toBe('Europe/Berlin'); // DEFAULT_TIME_ZONE fallback
  expect(tz.secondary).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — `getOrgTimeZones is not a function`.

- [ ] **Step 3: Add a thin public wrapper** (keep the private impl) in `google-calendar-read.service.ts`:

```ts
  // Public accessor for callers outside the calendar (e.g. Engage meeting emails) that
  // need the org's resolved primary + secondary sales zones (the same the calendar uses).
  getOrgTimeZones(orgId: string): Promise<{ primary: string; secondary: string | null }> {
    return this.resolveOrgTimeZones(orgId);
  }
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/google/google-calendar-read.service.ts erp-server/test/calendar-read.spec.ts
git commit -m "feat(calendar): public getOrgTimeZones accessor"
```

---

## Task 3: System-owned time block in meeting emails + org-tz calendar event

**Files:**
- Modify: `erp-server/src/engage/engage-replies.service.ts`
- Test: `erp-server/test/engage-meeting-time.spec.ts`

Introduce one private helper and use it at the three send/draft points; fix the hardcoded calendar timezone.

- [ ] **Step 1: Write the failing test** (unit-level: drive the helper with a fake calendar)

```ts
// erp-server/test/engage-meeting-time.spec.ts
import { withMeetingTime } from '../src/engage/engage-replies.service'; // exported helper (see Step 3a)

const SLOT = { start: '2026-06-25T07:30:00.000Z', end: '2026-06-25T08:00:00.000Z' };

describe('withMeetingTime', () => {
  it('appends one marker-delimited time block grounded in the slot', () => {
    const body = withMeetingTime('Hi Anna,\n\nLooking forward to it!', [SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    expect(body).toContain('09:30');           // real slot time, not invented
    expect(body).toContain('GMT+2');
    expect(body).toContain('GMT+7');
    expect((body.match(/<!--meeting-time-->/g) ?? []).length).toBe(1); // exactly one block
  });

  it('is idempotent — re-applying replaces, never duplicates, the block', () => {
    const once = withMeetingTime('Body', [SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    const twice = withMeetingTime(once, [SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    expect((twice.match(/<!--meeting-time-->/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module/export not found.

- [ ] **Step 3a: Add the pure helper** (exported) in `engage-replies.service.ts`, above the class:

```ts
import { formatMeetingTimeBlock, type Slot } from './meeting-time-format';

// Markers fence the system-owned time block so re-application replaces (never duplicates)
// it, and so the block is unmistakably system-rendered (not LLM prose). The markers are
// HTML comments — invisible in rendered email, harmless in plain text.
const MTG_OPEN = '<!--meeting-time-->';
const MTG_CLOSE = '<!--/meeting-time-->';
const MTG_BLOCK = new RegExp(`\\n*${MTG_OPEN}[\\s\\S]*?${MTG_CLOSE}`, 'g');

export function withMeetingTime(
  body: string,
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
): string {
  const stripped = body.replace(MTG_BLOCK, '').trimEnd();
  if (slots.length === 0) return stripped;
  const label = slots.length > 1 ? 'Proposed times' : 'Proposed time';
  const block =
    `${MTG_OPEN}\n\n${label} (your local time in brackets):\n` +
    `${formatMeetingTimeBlock(slots, primaryTz, secondaryTz)}\n${MTG_CLOSE}`;
  return `${stripped}\n\n${block}`;
}
```

- [ ] **Step 3b: Add a private resolver+apply method** on the class (uses the public accessor from Task 2; the calendar service is already injected as `this.calendar`):

```ts
  // Resolve the org's zones and stamp the authoritative time block onto a meeting email.
  private async stampMeetingTime(orgId: string, body: string, slots: Slot[]): Promise<string> {
    if (!slots.length) return body;
    const { primary, secondary } = await this.calendar.getOrgTimeZones(orgId);
    return withMeetingTime(body, slots, primary, secondary);
  }
```

- [ ] **Step 3c: Apply at PROPOSED send** — in `sendReply`, before building the raw email, replace the use of `body` with the stamped body when slots are present:

```ts
    const slots = proposedSlots ?? (proposedSlot ? [proposedSlot] : []);
    const finalBody = await this.stampMeetingTime(orgId, body, slots);
    // ... use finalBody in buildRawReply(...) and persist draftBody: finalBody ...
```

- [ ] **Step 3d: Apply at ACCEPTED confirmation** — in `applyScheduling` ACCEPTED branch, after setting `acceptedSlot`, normalize the stored draft so the confirmation shows the real time:

```ts
      const existing = await this.loadExistingReply(orgId, aim.id, leadId);
      if (existing) {
        const body = await this.stampMeetingTime(orgId, existing.draftBody ?? '', [resolution.acceptedSlot]);
        await this.db.update(schema.reachLeadReplies)
          .set({ draftBody: body, updatedAt: new Date() })
          .where(and(tenantScope(orgId, schema.reachLeadReplies), eq(schema.reachLeadReplies.id, existing.id)));
      }
```

- [ ] **Step 3e: Apply at COUNTER** — in the COUNTER branch, stop passing raw ISO in the instruction; redraft for the prose only, then stamp the structured alternatives:

```ts
      // (after the existing redraftReply call that proposes alternatives in prose)
      const reStamped = await this.stampMeetingTime(orgId, /* the redrafted body */ redrafted.draftBody ?? '', resolution.alternatives);
      await this.db.update(schema.reachLeadReplies)
        .set({ draftBody: reStamped, updatedAt: new Date() })
        .where(and(tenantScope(orgId, schema.reachLeadReplies), eq(schema.reachLeadReplies.id, existing.id)));
      // and change the redraft instruction to NOT include ISO times:
      // 'Their requested time is unavailable. Propose alternative times (the exact times are shown below your message — do not restate them).'
```

- [ ] **Step 3f: Org-tz calendar event** — in `sendReply`'s `createEvent` call, replace `timeZone: 'Europe/Berlin'` with the org's resolved primary zone:

```ts
    const { primary } = await this.calendar.getOrgTimeZones(orgId);
    await this.calendar.createEvent(orgId, {
      title: `EVERTRUST × ${lead.company} — intro call`,
      start: proposedSlot.start,
      end: proposedSlot.end,
      timeZone: primary,           // was hardcoded 'Europe/Berlin'
      attendees: [{ email: lead.email }],
      addGoogleMeet: true,
    });
```

- [ ] **Step 4: Run the test** — `corepack pnpm --filter @evertrust/api test -- --testPathPattern engage-meeting-time` → PASS (2 tests). Then `corepack pnpm --filter @evertrust/api test -- --testPathPattern "engage-meeting-loop|engage-replies.scheduling"` → still green (no regression).

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/engage/engage-replies.service.ts erp-server/test/engage-meeting-time.spec.ts
git commit -m "feat(engage): system-owned dual-zone time block on meeting emails; org-tz calendar event"
```

---

## Task 4: Drafter must not invent times (erp-agents prompt)

**Files:**
- Modify: `erp-agents/src/erp_agents/workflows/engage/reply_glock/prompts.py` (`DRAFT_SYSTEM_PROMPT`)
- Test: `erp-agents/.../tests/` — a prompt-content assertion (the LLM call isn't run in CI)

- [ ] **Step 1: Write the failing test**

```python
# erp-agents/.../tests/test_draft_prompt.py
from erp_agents.workflows.engage.reply_glock.prompts import DRAFT_SYSTEM_PROMPT

def test_draft_prompt_forbids_inventing_times():
    p = DRAFT_SYSTEM_PROMPT.lower()
    assert "do not state" in p or "never state" in p
    assert "time" in p and ("below" in p or "appended" in p)
```

- [ ] **Step 2: Run to verify it fails** — `pytest erp-agents -k draft_prompt` → FAIL.

- [ ] **Step 3: Add the rule to `DRAFT_SYSTEM_PROMPT`** (append a bullet):

```
- NEVER state a specific date, day, or clock time. When a meeting time is relevant,
  refer to it generically ("the time below", "the proposed time"). The exact time —
  in the recipient's timezone — is appended beneath your message by the system; if you
  write your own time it WILL contradict the calendar invite. Do not output any time.
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add erp-agents/src/erp_agents/workflows/engage/reply_glock/prompts.py erp-agents/.../tests/test_draft_prompt.py
git commit -m "fix(agent): drafter must not invent meeting times (system appends them)"
```

---

## Final verification

- [ ] `corepack pnpm --filter @evertrust/db build && corepack pnpm --filter @evertrust/api typecheck` — no new errors vs base.
- [ ] `corepack pnpm --filter @evertrust/api test -- --testPathPattern "meeting-time-format|engage-meeting-time|engage-meeting-loop|calendar-read"` — all green.
- [ ] `pytest erp-agents -k draft_prompt` — green.
- [ ] Manual e2e (against the running stack): re-stamp granozita's reply via the ACCEPTED path → `draft_body` shows `09:30 (GMT+2) · 14:30 (GMT+7)`, matching the calendar.

## Out of scope (flagged, not in this plan)

- **Coaching-scaffolding leak** (`[00:00] Value Equation / Strengths…` bleeding into `draft_body`) — the explorer could not locate its source in `prompts.py`; needs its own investigation. Tracked as a separate follow-up.
- Localizing the email language / honoring the lead's own timezone (we render primary + GMT+7 cross-ref only).
- Retroactively rewriting already-sent drafts.

## Self-review notes

- **Determinism:** the client-facing time is always `formatMeetingTimeBlock(...)` from the same slot the calendar books — the LLM is barred from writing times (Task 4), so they cannot diverge.
- **Idempotency:** `withMeetingTime` strips any prior `<!--meeting-time-->` block before appending — re-stamping (ACCEPTED after PROPOSED) never duplicates.
- **Multi-tenant:** zones come from `getOrgTimeZones(orgId)` (org override ?? env ?? Europe/Berlin); the calendar event now uses the org's primary zone, not a hardcoded one.
- **Type consistency:** `Slot = {start, end}` shared from `meeting-time-format.ts`; `getOrgTimeZones` returns `{primary: string, secondary: string|null}` end to end.
