# Activate calendar — views, filters, color code & free-slot mode

**Date:** 2026-06-19
**Status:** Design approved (brainstorm), ready for implementation plan
**Base:** `main` @ `6841fa7` (post per-org timezone #39 + Gmail/RBAC/free-slot-duration #41)
**Surface:** `erp-client/src/components/activate/*`, `erp-server/src/google/google-calendar-read.service.ts`, `packages/shared` calendar DTOs.

## Goal

Turn the Activate "Book a meeting" calendar from a single Mon–Fri week grid into a
proper calendar surface: full 7-day weeks, switchable **Day / Week / Month** layouts, a
**Campaign** filter, an event **color code** that distinguishes client meetings from
personal/team/reminders/out-of-office, and a **"Check for free slot"** mode that strips
the view to bookable openings. Multi-tenant rules unchanged — every read stays org-scoped
via the existing `resolveMailbox(orgId, …)` path; no hardcoded org values.

This is display/UX correctness over the existing live Google-Calendar read. Event data
and the per-org timezone resolution (from #39) are unchanged.

## Capabilities

1. **Weekends** — the week grid runs Mon–**Sun** (Sat/Sun were missing).
2. **Day / Week / Month views** — a segmented switcher; each is a distinct layout.
3. **Event color code** — 5 categories + free slots, derived per event (hybrid rules).
4. **"Check for free slot"** — a toggle that hides everything but the green free slots.
5. **Campaign filter** — a dropdown that filters events to a chosen campaign (by attendee match).

---

## Backend

### `CalendarEventDto` (packages/shared) — new fields

```
category: 'client' | 'team' | 'personal' | 'reminder' | 'ooo'   // derived, always present
allDay: boolean                                                 // start.date && !start.dateTime
colorId: string | null                                          // Google's raw colorId (for optional override / future tinting)
campaignIds: string[]                                           // matched campaigns (empty when no attendee maps to a prospect)
```

The client maps `campaignIds` → names via the existing campaign list (`useCampaigns`), so
the DTO carries ids only.

### Category classification — hybrid (decision **C**), structural signals only

In `GoogleCalendarReadService.upcoming()`, per event, **first match wins**:

1. `eventType === 'outOfOffice'` → **ooo**
2. all-day (`start.date` present, no `start.dateTime`) → **reminder**
3. has an **external** attendee (after the existing self/own-domain/resource filter) → **client**
4. has attendees, **internal-only** → **team**
5. otherwise (timed, no attendees) → **personal**

No keyword matching (fragile, i18n-dependent). Parse `eventType` + `colorId` from the
Google `events.list` items (extend the `EventsListResponse` interface).

**Optional per-org `colorId → category` override** — a `org_config.calendarColorMap`
(jsonb, nullable, default null = off). When set and an event carries a mapped `colorId`,
it overrides the derived category. **Deferred from v1** (ship rules-only); documented here
so the field/contract is reserved. *(Out of scope for the first plan.)*

### Campaign match (filter approach **A**)

After building the event list, collect every external attendee email across all events,
run one org-scoped query:

```sql
SELECT email, campaign_id FROM prospects
WHERE organization_id = :orgId AND email IN (:emails)
```

Build `email → campaignId[]` (a prospect email can belong to several campaigns — unique
key is `(campaign_id, email)`), then attach `campaignIds` to each event by its external
attendees. Empty array when nothing matches. Never-throw contract preserved — a failed
lookup degrades to empty `campaignIds`, not an error.

`GoogleCalendarReadService` already has the DB client (added in #39); the prospects query
is a plain org-scoped read.

### Untouched

Free-slot computation (`computeFreeSlots`, with `tz` from #39 and `durationMinutes` from
#41) is unchanged — the "free-slot mode" is purely a frontend display toggle. The
`free-slots` endpoint is unchanged.

---

## Frontend

### Refactor (prerequisite)

`activate-view.tsx` is ~1450 lines; three layouts would make it unmaintainable. Split into
`erp-client/src/components/activate/calendar/`:

- `calendar.tsx` — orchestrator: view/campaign/free-slot state, data fetching, range nav.
- `control-bar.tsx` — view switcher + campaign filter + nav + "Check for free slot" button + connected pill.
- `week-view.tsx`, `day-view.tsx`, `month-view.tsx` — the three layouts.
- `event-block.tsx`, `slot-block.tsx` — shared blocks (timezone-aware, from #39).
- `time-grid.ts` — the existing zone math (`zonedTimeToUtcDate`, `getVisualRangeForDateKey`,
  `formatClockInTimeZone`, `zoneShortLabel`, day-key helpers) **moved verbatim** — no logic change.
- `event-category.ts` — `category → { borderClass, tintClass, label }` map (DESIGN.md
  semantic palette: `border-{c}-500/30 bg-{c}-500/10 text-{c}-400`).

`activate-view.tsx` keeps the page shell (PageHeader, AccountBar, the Book/Research/After
SegmentedTabs) and renders `<Calendar/>` in the Book tab.

### State & navigation (in `calendar.tsx`)

- `view: 'day' | 'week' | 'month'` (default `'week'`).
- `campaignId: string | null` (`null` = All).
- `freeOnly: boolean` (default false).
- Anchor date key. Prev/Next/Today step by the view's unit (±1 day / ±7 days / ±1 month).
- **Fetch window adapts per view**, buffered ±1 day (per #39, to avoid edge-clipping when
  render zone ≠ fetch zone): day = that day ±1; week = that week ±1; month = the visible
  month grid (incl. leading/trailing days) ±1. Both `upcoming` and `free-slots` use it.

### Views

- **Week** — current time grid, extended to **Mon–Sun**; weekend columns faintly tinted
  (`bg-white/[.02]`) but still render events. Reuses `getVisualRangeForDateKey` per day.
- **Day** — single-day timeline: taller hour rows, richer `event-block` (title, time,
  guests, Google Meet badge), free slots with an inline **Book** action.
- **Month** — calendar-month grid (Mon-start, 5–6 rows). Each cell: date number, up to ~2
  event chips (colored by category) + "+N more", and a green **"N free"** pill counting that
  day's free slots. No time gutter. Today + weekend cells styled. Clicking a day → switches
  to Day view for that date.

### Color code

`event-block` applies `event-category.ts` classes by `event.category`:
🔵 client · 🟣 team · 🟡 personal · ⚪ reminder · 🔴 ooo. **All-day** reminders & OOO render
in a thin "all-day" strip above the time grid (Day/Week), not as positioned blocks.
🟢 free slots keep the emerald dashed style (unchanged). A small **legend** sits in the
card header, on the row directly below the control bar.

### "Check for free slot" toggle

`freeOnly` boolean. On: Day/Week hide all `event-block`s and emphasize the green slots
(solid border, "· Book"); **Month** dims every day with zero free slots so openings pop.
Button flips to "✕ Exit free-slot view." A short banner notes the mode. Frontend-only.

### Campaign filter

Dropdown sourced from `useCampaigns()` (existing `GET /campaigns`). Selecting a campaign
keeps only events whose `campaignIds` include it (others hidden); "All" shows everything.
**Free slots always show** (not campaign-bound). Filtering is client-side over fetched data.

---

## Data flow

```
view/campaign/freeOnly/anchor (calendar.tsx state)
        │  derive fetch window (per view, ±1d buffer)
        ▼
useCalendarUpcoming(range) ──► GET /meetings/calendar/upcoming
        │                         └─ resolve tz (#39) · classify category · match campaignIds
useCalendarFreeSlots(range) ─► GET /meetings/calendar/free-slots (tz #39, duration #41)
        ▼
client filters by campaignId + freeOnly  ──►  Day | Week | Month view
```

## Testing

- **Backend (jest):** `category` classifier — one test per rule + precedence (ooo > reminder
  > client > team > personal); attendee→campaign matcher — org-scoped (no cross-tenant
  leak), multi-campaign email, no-match → empty. Existing slot/timezone/duration tests stay green.
- **Frontend:** no test suite — verify via dev preview: each view renders, weekend columns
  appear, color code matches the legend, free-slot toggle + campaign filter behave, timezone
  positioning still correct (regression of #39).

## Out of scope / future

- **`colorId → category` override map** (per-org) — reserved field; rules-only in v1.
- **Approach B** (overlay ERP Read.ai meetings as a campaign-attributed source) — not built;
  the calendar stays the live Google view.
- **Keyword-based** personal detection — intentionally omitted.

## Resolved decisions

- Campaign filter = **A** (attendee→prospect match on the live calendar).
- Classification = **C**, structural-only; `colorId` override deferred.
- "Personal" = timed event with no attendees (a no-attendee work block reads as personal — accepted).
