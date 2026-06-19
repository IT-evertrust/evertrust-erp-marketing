# Activate Calendar Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Day/Week/Month views, a campaign filter, an event color code, weekend columns, and a "Check for free slot" mode to the Activate calendar — built to production on `feat/activate-calendar-views` (off `main` @ #41).

**Architecture:** Backend enriches `CalendarEventDto` with a derived `category`, `allDay`, raw `colorId`, and matched `campaignIds` (org-scoped attendee→prospect lookup). Frontend splits the 1450-line `activate-view.tsx` into a focused `calendar/` module, then layers the three views, color code, free-slot toggle, and filter on top. Per-org timezone math (#39) is preserved verbatim.

**Tech Stack:** NestJS 11 + Drizzle (erp-server), Next.js 15 / React 19 / Tailwind v4 / shadcn (erp-client), Zod DTOs (@evertrust/shared), jest (api only).

---

## File Structure

**Backend**
- Modify `packages/shared/src/index.ts` — `CalendarEventDto` (+ `category`, `allDay`, `colorId`, `campaignIds`) + a `CalendarEventCategory` enum.
- Modify `erp-server/src/google/google-calendar-read.service.ts` — `classifyEvent()` (pure, exported), `resolveEventCampaigns()` (DB), wire both into `upcoming()`, parse `colorId`/`eventType`.
- Test `erp-server/test/google-calendar-classify.spec.ts` (pure classifier).
- Test `erp-server/test/google-calendar-campaign-match.spec.ts` (matcher, via fake-db).

**Frontend** — new `erp-client/src/components/activate/calendar/`
- `calendar.tsx` — orchestrator (state, fetch, range nav).
- `control-bar.tsx`, `calendar-legend.tsx`.
- `week-view.tsx`, `day-view.tsx`, `month-view.tsx`.
- `event-block.tsx`, `slot-block.tsx`, `event-details-dialog.tsx`.
- `time-grid.ts` (zone math moved verbatim from activate-view), `event-category.ts`, `types.ts`.
- Modify `activate-view.tsx` — render `<Calendar/>` in the Book tab; drop the moved code.
- Modify `erp-client/messages/{en,de}/activate.json` — legend labels, view names, filter/free-slot copy.

---

## Phase 1 — Backend

### Task 1: Shared DTO — category + new event fields

**Files:** Modify `packages/shared/src/index.ts` (the `CalendarEventDto` block ~L499).

- [ ] **Step 1: Add the category enum + fields above `CalendarEventDto`**

```ts
// Activate calendar event category (derived server-side, hybrid rules). 'ooo' =
// out-of-office, 'reminder' = all-day, else client/team/personal by attendees.
export const CALENDAR_EVENT_CATEGORIES = ['client', 'team', 'personal', 'reminder', 'ooo'] as const;
export const CalendarEventCategory = z.enum(CALENDAR_EVENT_CATEGORIES);
export type CalendarEventCategory = z.infer<typeof CalendarEventCategory>;
```

- [ ] **Step 2: Add fields to `CalendarEventDto`** (after `creatorEmail`)

```ts
  // Derived category for the color code; always present.
  category: CalendarEventCategory.default('personal'),
  // True for all-day events (Google `start.date`, no `dateTime`).
  allDay: z.boolean().default(false),
  // Google's raw colorId (reserved for an optional per-org override; UI may tint).
  colorId: z.string().nullable().default(null),
  // Campaigns this event maps to via attendee→prospect match (empty when none).
  campaignIds: z.array(z.string()).default([]),
```

- [ ] **Step 3: Typecheck** — `corepack pnpm --filter @evertrust/shared typecheck` → clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(shared): calendar event category + campaign/allDay/colorId fields"`

### Task 2: Pure category classifier (TDD)

**Files:** Modify `google-calendar-read.service.ts`; Test `erp-server/test/google-calendar-classify.spec.ts`.

The classifier takes the minimal shape it needs so it's pure/testable. `selfDomain` is the org's own email domain (already derived in `upcoming()`).

- [ ] **Step 1: Write the failing test**

```ts
import { classifyEvent } from '../src/google/google-calendar-read.service';

const ext = [{ email: 'buyer@acme.io', self: false, resource: false }];
const intl = [{ email: 'colleague@evertrust-germany.de', self: false, resource: false }];

describe('classifyEvent', () => {
  const dom = 'evertrust-germany.de';
  it('ooo wins on eventType outOfOffice', () =>
    expect(classifyEvent({ eventType: 'outOfOffice', allDay: false, attendees: ext }, dom)).toBe('ooo'));
  it('all-day → reminder', () =>
    expect(classifyEvent({ eventType: 'default', allDay: true, attendees: ext }, dom)).toBe('reminder'));
  it('external attendee → client', () =>
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: ext }, dom)).toBe('client'));
  it('internal-only attendees → team', () =>
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: intl }, dom)).toBe('team'));
  it('no attendees → personal', () =>
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: [] }, dom)).toBe('personal'));
  it('precedence: ooo before reminder', () =>
    expect(classifyEvent({ eventType: 'outOfOffice', allDay: true, attendees: [] }, dom)).toBe('ooo'));
});
```

- [ ] **Step 2: Run, expect FAIL** — `corepack pnpm --filter @evertrust/api test -- google-calendar-classify` → "classifyEvent is not a function".

- [ ] **Step 3: Implement `classifyEvent` (exported, pure) in the service**

```ts
import type { CalendarEventCategory } from '@evertrust/shared';

interface ClassifyInput {
  eventType?: string;
  allDay: boolean;
  attendees: { email?: string; self?: boolean; resource?: boolean }[];
}

// Hybrid (structural) category rules — first match wins.
export function classifyEvent(e: ClassifyInput, selfDomain: string): CalendarEventCategory {
  if (e.eventType === 'outOfOffice') return 'ooo';
  if (e.allDay) return 'reminder';
  const real = e.attendees.filter((a) => !a.self && !a.resource && !!a.email);
  if (real.length === 0) return 'personal';
  const hasExternal = real.some(
    (a) => !(selfDomain && (a.email as string).toLowerCase().endsWith(`@${selfDomain}`)),
  );
  return hasExternal ? 'client' : 'team';
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(api): pure calendar event classifier"`

### Task 3: Campaign matcher (TDD, org-scoped)

**Files:** Modify `google-calendar-read.service.ts`; Test `erp-server/test/google-calendar-campaign-match.spec.ts`.

`resolveEventCampaigns(orgId, emails)` returns `Map<emailLower, campaignId[]>` from one org-scoped prospects query. Uses the injected `this.db`.

- [ ] **Step 1: Write the failing test** (fake-db pattern — mirror `test/fake-db.ts` usage in `prospects.service.spec.ts`)

```ts
// Seeds prospects across two orgs; the matcher must only see ORG's rows and
// group campaignIds per email (one email can be in several campaigns).
// (Full fake-db wiring mirrors test/prospects-board.service.spec.ts.)
```

Assert: `buyer@acme.io` → `['camp-1','camp-2']`; an OTHER-org row for the same email is excluded; unknown email absent.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
private async resolveEventCampaigns(
  orgId: string,
  emails: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];
  if (uniq.length === 0) return out;
  try {
    const rows = await this.db
      .select({ email: schema.prospects.email, campaignId: schema.prospects.campaignId })
      .from(schema.prospects)
      .where(and(eq(schema.prospects.organizationId, orgId), inArray(schema.prospects.email, uniq)));
    for (const r of rows) {
      const key = r.email.toLowerCase();
      const list = out.get(key) ?? [];
      if (!list.includes(r.campaignId)) list.push(r.campaignId);
      out.set(key, list);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    this.logger.warn(`resolveEventCampaigns failed for org ${orgId}: ${msg}`);
  }
  return out;
}
```

Add `and`, `inArray` to the `drizzle-orm` import.

- [ ] **Step 4: Run, expect PASS. Step 5: Commit.**

### Task 4: Wire classifier + matcher into `upcoming()`

**Files:** Modify `google-calendar-read.service.ts` (the `EventsListResponse` interface + the `flatMap` that builds events + the return).

- [ ] **Step 1:** Add `eventType?: string;` and `colorId?: string;` to the `EventsListResponse` items interface.
- [ ] **Step 2:** In `upcoming()`, after building the raw `events` array, compute campaign map and attach fields:

```ts
// After the existing flatMap that produces CalendarEventDto[] WITHOUT the new fields,
// collect external attendee emails and resolve campaigns in one query.
const allExternalEmails = events.flatMap((e) => e.attendees);
const campaignMap = await this.resolveEventCampaigns(orgId, allExternalEmails);
```

Inside the `flatMap`, set on each event object:
```ts
allDay: !item.start?.dateTime && !!item.start?.date,
colorId: item.colorId ?? null,
category: classifyEvent(
  { eventType: item.eventType, allDay: !item.start?.dateTime && !!item.start?.date, attendees: item.attendees ?? [] },
  selfDomain,
),
campaignIds: [], // filled below
```
Then after `campaignMap`:
```ts
for (const e of events) {
  const ids = new Set<string>();
  for (const email of e.attendees) (campaignMap.get(email.toLowerCase()) ?? []).forEach((c) => ids.add(c));
  e.campaignIds = [...ids];
}
```

- [ ] **Step 3:** Full api test + typecheck — `corepack pnpm --filter @evertrust/api test` (all green, incl. new specs) and `typecheck`.
- [ ] **Step 4: Commit** — `git commit -am "feat(api): classify + campaign-match Activate calendar events"`

---

## Phase 2 — Frontend refactor (no behavior change)

> The client has **no test suite** — verify each phase via `pnpm --filter @evertrust/web typecheck`, `lint`, and the dev preview (the calendar must render identically to before until the new features land).

### Task 5: Extract `time-grid.ts` (move zone math verbatim)

**Files:** Create `erp-client/src/components/activate/calendar/time-grid.ts`; Modify `activate-view.tsx`.

- [ ] **Step 1:** Move these functions **unchanged** from `activate-view.tsx` into `time-grid.ts` and `export` each: `pad2`, `toDateKey`, `parseDateKey`, `dateKeyToUtcDate`, `addDaysToDateKey`, `getZonedParts`, `zonedTimeToUtcDate`, `startOfWorkWeekKey`, `isValidDate`, `overlapsDateKey`, `overlapsDateKeyRange`, `getVisualRangeForDateKey`, `zonedMinutesSinceMidnight`, `minuteToTop`, `minuteRangeToHeight`, `getIsoWeekNumber`, `formatClockInTimeZone`, `zoneShortLabel`, plus `HOUR_HEIGHT`, `HOURS`, `DEFAULT_TIME_ZONE`.
- [ ] **Step 2:** Import them in `activate-view.tsx`. No logic change.
- [ ] **Step 3:** `typecheck` + `lint` clean; preview the Book tab → renders identically.
- [ ] **Step 4: Commit** — `git commit -am "refactor(activate): extract calendar time-grid utils"`

### Task 6: Extract `types.ts`, `event-block.tsx`, `slot-block.tsx`, `event-details-dialog.tsx`, `calendar.tsx`

**Files:** Create the above under `calendar/`; Modify `activate-view.tsx`.

- [ ] **Step 1:** Move `CalendarGridEvent`, `CalendarGridSlot`, `CalendarEventLayout`, `LaidOutCalendarEvent`, `UpcomingQuery`, `FreeSlotsQuery` types into `types.ts`.
- [ ] **Step 2:** Move `CalendarEventBlock`+`getEventBlockStyle`+`layoutDayEvents`+`getEventString`+`stripHtml` into `event-block.tsx`; `CalendarSlotBlock` into `slot-block.tsx`; `CalendarEventDetailsDialog`+`EventDetailRow` into `event-details-dialog.tsx`. Keep props/behavior identical (incl. `primaryTz`/`secondaryTz`).
- [ ] **Step 3:** Move `BookTab` body into `calendar/calendar.tsx` exporting `<Calendar upcoming freeSlots weekStartKey onWeekStartKeyChange primaryTz secondaryTz/>`; keep the week grid + `TimeScaleHeader`/`TimeScaleColumns`/`DayColumn` for now.
- [ ] **Step 4:** `activate-view.tsx` imports `<Calendar/>` for the Book tab; the page shell (PageHeader/AccountBar/SegmentedTabs + the `useCalendarUpcoming/FreeSlots` calls + `calendarRange`/zone derivation) stays in `activate-view.tsx` and passes props down.
- [ ] **Step 5:** `typecheck` + `lint` clean; preview parity. **Commit.**

---

## Phase 3 — Features

### Task 7: `event-category.ts` color map + apply to event blocks

**Files:** Create `calendar/event-category.ts`; Modify `event-block.tsx`.

- [ ] **Step 1:** Create the map (DESIGN.md semantic classes; no new colors beyond the set):

```ts
import type { CalendarEventCategory } from '@evertrust/shared';

export const CATEGORY_STYLE: Record<CalendarEventCategory,
  { bar: string; tint: string; label: string }> = {
  client:   { bar: 'border-l-blue-500',   tint: 'text-blue-300',   label: 'Client meeting' },
  team:     { bar: 'border-l-violet-500', tint: 'text-violet-300', label: 'Internal / team' },
  personal: { bar: 'border-l-amber-500',  tint: 'text-amber-300',  label: 'Personal' },
  reminder: { bar: 'border-l-slate-500',  tint: 'text-slate-300',  label: 'Reminder' },
  ooo:      { bar: 'border-l-rose-500',   tint: 'text-rose-300',   label: 'Out of office' },
};
```

- [ ] **Step 2:** In `event-block.tsx`, replace the hardcoded `border-l-blue-500` with `CATEGORY_STYLE[event.category].bar` and tint the title with `.tint`.
- [ ] **Step 3:** `typecheck`/`lint`/preview → events render by category color. **Commit.**

### Task 8: Week view → Mon–Sun + weekend tint + all-day strip

**Files:** Create `calendar/week-view.tsx` (from the grid currently in `calendar.tsx`); Modify `calendar.tsx`.

- [ ] **Step 1:** `WORK_WEEK_DAYS` 5 → **7**; `startOfWorkWeekKey` already returns Monday → 7 days now include Sat/Sun. Add `bg-white/[.02]` to Sat/Sun `DayColumn` + header cells (compute `isWeekend` from the day index ≥ 5).
- [ ] **Step 2:** Add an **all-day strip** row above the time grid: events with `allDay===true` (category `reminder`/`ooo`) render as full-width chips in the strip per day, not positioned blocks; filter them out of the timed grid.
- [ ] **Step 3:** preview → 7 columns, weekends tinted, all-day reminders/OOO in the top strip. **Commit.**

### Task 9: `control-bar.tsx` — view switcher + nav + campaign filter + free-slot button + legend

**Files:** Create `calendar/control-bar.tsx`, `calendar/calendar-legend.tsx`; Modify `calendar.tsx` (lift `view`, `campaignId`, `freeOnly`, anchor state).

- [ ] **Step 1:** `calendar.tsx` state: `const [view,setView]=useState<'day'|'week'|'month'>('week')`, `const [campaignId,setCampaignId]=useState<string|null>(null)`, `const [freeOnly,setFreeOnly]=useState(false)`. Nav steps by view unit; fetch window (`calendarRange`) derives from `view`+anchor, buffered ±1 day (reuse the #39 buffer approach).
- [ ] **Step 2:** `control-bar.tsx` renders the `SegmentedTabs`-style switcher (reuse `@/components/ui/tabs` look), a shadcn `Select` for campaigns (options from `useCampaigns()`), `‹/›/Today`, the range label, and the emerald **"Check for free slot"** toggle button (filled when active). Legend below via `calendar-legend.tsx` mapping `CATEGORY_STYLE`.
- [ ] **Step 3:** Wire `useCampaigns` (existing hook). preview → controls present; switching `view` toggles which `*-view` renders. **Commit.**

### Task 10: Day view

**Files:** Create `calendar/day-view.tsx`; Modify `calendar.tsx` (render when `view==='day'`).

- [ ] **Step 1:** Single-day timeline: one `DayColumn`-style column at full width, taller (`HOUR_HEIGHT` rows for the day), dual-tz gutter, richer `event-block` variant (title + time + guests + Meet badge), free slots with inline **Book** (Book is a no-op stub → wire to the existing create-event flow later / out of scope here; render the button disabled with a tooltip "coming soon" OR open the existing details). Use `getVisualRangeForDateKey(start,end,dayKey,primaryTz)` for the single day.
- [ ] **Step 2:** preview → day timeline renders, switches via control bar. **Commit.**

### Task 11: Month view

**Files:** Create `calendar/month-view.tsx`, helper `monthGridDays(anchorKey, tz)` in `time-grid.ts`; Modify `calendar.tsx`.

- [ ] **Step 1:** `monthGridDays` returns the Mon-start 6×7 date-key grid for the anchor's month (incl. leading/trailing days, flagged `inMonth`). Pure, add to `time-grid.ts`.
- [ ] **Step 2:** `month-view.tsx`: per cell, bucket events by `overlapsDateKey(start,end,cellKey,primaryTz)`; show ≤2 category-colored chips + "+N more"; count free slots that day → green "N free" pill; tint weekend + dim out-of-month cells; click a cell → `setView('day')` + set anchor to that day.
- [ ] **Step 3:** preview → month grid renders, chips colored, free counts correct, click→day. **Commit.**

### Task 12: "Check for free slot" mode

**Files:** Modify `week-view.tsx`, `day-view.tsx`, `month-view.tsx`, `control-bar.tsx`.

- [ ] **Step 1:** Thread `freeOnly` into the views. Day/Week: when true, render only slot blocks (skip event blocks + all-day strip), emphasize slots. Month: dim cells with `freeCount===0`, hide event chips. Control-bar button label flips to "✕ Exit free-slot view" + filled style; show a one-line banner in the card when active.
- [ ] **Step 2:** preview → toggle hides events / shows slots in each view. **Commit.**

### Task 13: Campaign filter behavior

**Files:** Modify `calendar.tsx` (filter events before passing to views).

- [ ] **Step 1:** When `campaignId !== null`, filter `gridEvents` to those whose `event.campaignIds.includes(campaignId)`; free slots pass through unchanged. "All" = no filter.
- [ ] **Step 2:** preview → selecting a campaign narrows events; slots unaffected. **Commit.**

### Task 14: i18n + final verification

**Files:** Modify `messages/{en,de}/activate.json`.

- [ ] **Step 1:** Add keys for view names (Day/Week/Month), the campaign filter label/"All", "Check for free slot"/"Exit free-slot view", the legend category labels, and the free-slot banner — EN + DE parity. Replace hardcoded strings in the new components with `t(...)`.
- [ ] **Step 2:** Full gate: `corepack pnpm --filter @evertrust/api test` (green), `pnpm -r typecheck` (4/4), `pnpm --filter @evertrust/web lint` (no new errors).
- [ ] **Step 3:** Dev preview pass: all three views render; weekends present; color code matches legend; free-slot toggle + campaign filter work in each view; timezone positioning still correct (regression check of #39, incl. a non-Berlin org).
- [ ] **Step 4:** code-reviewer subagent pass. **Commit**, push, open PR to `main`.

---

## Self-review notes
- Spec coverage: weekends (T8), Day/Week/Month (T8/10/11), color code (T1/7/8), free-slot (T12), campaign filter (T1/3/4/13), refactor (T5/6), classification C (T2), campaign-match A (T3). `colorId` override = deferred (spec out-of-scope) — `colorId` field still carried (T1) for the future.
- Types: `CalendarEventCategory`, `classifyEvent`, `resolveEventCampaigns`, `CATEGORY_STYLE` keys consistent across tasks.
- Frontend tasks verify via typecheck/lint/preview (no client test suite) — explicit per task.
