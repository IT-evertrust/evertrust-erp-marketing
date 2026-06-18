import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CalendarEventDto,
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
  CalendarMutationResultDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from '@evertrust/shared';
import { GoogleAccountsService } from './google-accounts.service';

// READ-side Google Calendar for the Activate page: real upcoming meetings + proposed
// free slots from the org's connected DEFAULT calendar mailbox.
//
// AUTH MODEL (per-org only): every read resolves the CALLING org's default Calendar
// account via GoogleAccountsService.getAccessTokenForOrg(orgId,'calendar') and uses
// that account's live access token against the Google Calendar REST API — so a tenant
// only ever sees its OWN calendar. Reuses the exact HTTP pattern of
// GoogleCalendarService.listCalendars (plain fetch + Bearer token).
//
// NEVER-THROW CONTRACT: these power a page load, so any failure (no default mailbox,
// no calendar scope, non-2xx, network error, bad body) is logged at warn level and
// degraded to a `configured: false` shell. The Activate UI degrades gracefully — it
// must never 500 the page.

// Business-hours slot window, in Europe/Berlin local time.
const SLOT_TZ = 'Europe/Berlin';
const BUSINESS_START_HOUR = 9; // 09:00 inclusive
const BUSINESS_END_HOUR = 17; // 17:00 exclusive (last slot starts 16:30)
const SLOT_MINUTES = 30;
const FREE_SLOT_HORIZON_DAYS = 7;
const MAX_FREE_SLOTS = 6;
const MAX_UPCOMING_EVENTS = 10;
const DEFAULT_CALENDAR_TIME_ZONE = 'Europe/Berlin';

type CalendarRangeInput = {
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  durationMinutes?: number;
};
interface BusyInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

// Minimal shape of a Google freeBusy response we depend on.
interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[] }>;
}

// Minimal shape of a Google events.list response we depend on.
interface EventsListResponse {
  items?: {
    id?: string;
    summary?: string;
    location?: string;
    hangoutLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: { email?: string; self?: boolean; resource?: boolean }[];
  }[];
}

// The Europe/Berlin local Y/M/D/H/M parts of an instant, DST-correct (uses the ICU
// tz database via Intl, so no tz library / no hardcoded +1/+2 offset).
function berlinParts(at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SLOT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some ICU builds emit "24" for midnight
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}

// The UTC instant for a given Europe/Berlin wall-clock time, DST-correct. We probe the
// zone's offset at a candidate UTC instant and correct once — sufficient outside the
// 1-hour DST fold, which never overlaps 09:00–17:00 business hours.
function berlinWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(asUtc);
  const p = berlinParts(probe);
  const seenAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = seenAsUtc - asUtc; // how far Berlin local ran ahead of UTC at probe
  return new Date(asUtc - offset);
}

// PURE slot computation (exported for unit testing). Given busy intervals and a
// reference `now`, returns up to `MAX_FREE_SLOTS` 30-minute openings within weekday
// 09:00–17:00 Europe/Berlin business hours over the next `FREE_SLOT_HORIZON_DAYS`
// days. A slot is free when it lies entirely in the future and overlaps no busy
// interval. Deterministic and timezone-correct (DST-aware via Intl).
export function computeFreeSlots(
  busy: BusyInterval[],
  now: Date = new Date(),
): { start: string; end: string }[] {
  const slotMs = SLOT_MINUTES * 60_000;
  const nowMs = now.getTime();
  const horizonMs = nowMs + FREE_SLOT_HORIZON_DAYS * 24 * 60 * 60_000;
  const out: { start: string; end: string }[] = [];

  // Walk each calendar day in the horizon by its Berlin date, generating candidate
  // slots within business hours. Iterate by UTC-midnight steps but resolve each
  // business-hour slot through the Berlin wall clock so DST shifts stay correct.
  for (let dayOffset = 0; dayOffset <= FREE_SLOT_HORIZON_DAYS; dayOffset++) {
    const probe = new Date(nowMs + dayOffset * 24 * 60 * 60_000);
    const { year, month, day, weekday } = berlinParts(probe);

    // Weekdays only (Mon–Fri).
    if (weekday === 0 || weekday === 6) continue;

    for (let h = BUSINESS_START_HOUR; h < BUSINESS_END_HOUR; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        const startDate = berlinWallClockToUtc(year, month, day, h, m);
        const startMs = startDate.getTime();
        const endMs = startMs + slotMs;

        if (startMs < nowMs) continue; // only future slots
        if (startMs >= horizonMs) continue; // within the 7-day horizon

        const overlapsBusy = busy.some((b) => startMs < b.end && endMs > b.start);
        if (overlapsBusy) continue;

        out.push({
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
        });
        if (out.length >= MAX_FREE_SLOTS) return out;
      }
    }
  }

  return out;
}

function resolveCalendarRange(input: CalendarRangeInput = {}) {
  const timeZone = input.timeZone || DEFAULT_CALENDAR_TIME_ZONE;

  const fallbackMin = new Date();
  const fallbackMax = new Date(fallbackMin.getTime() + 7 * 24 * 60 * 60 * 1000);

  const timeMinDate = input.timeMin ? new Date(input.timeMin) : fallbackMin;
  const timeMaxDate = input.timeMax ? new Date(input.timeMax) : fallbackMax;

  if (Number.isNaN(timeMinDate.getTime())) {
    throw new Error('Invalid timeMin query parameter.');
  }

  if (Number.isNaN(timeMaxDate.getTime())) {
    throw new Error('Invalid timeMax query parameter.');
  }

  if (timeMaxDate <= timeMinDate) {
    throw new Error('timeMax must be after timeMin.');
  }

  return {
    timeMin: timeMinDate.toISOString(),
    timeMax: timeMaxDate.toISOString(),
    timeZone,
  };
}

@Injectable()
export class GoogleCalendarReadService {
  private readonly logger = new Logger(GoogleCalendarReadService.name);

  constructor(private readonly googleAccounts: GoogleAccountsService) {}

  // The next upcoming real events from the org's primary calendar. Never throws —
  // returns a `configured: false` shell when the org has no default calendar mailbox
  // or Google is unreachable.
  async upcoming(orgId: string, rangeInput: CalendarRangeInput = {}): Promise<CalendarUpcomingDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');
    if (!access.ok) {
      return { configured: false, account: null, events: [], reason: access.reason };
    }
    const perOrg = access;
    const range = resolveCalendarRange(rangeInput);
    const selfEmail = perOrg.account.email.toLowerCase();
    const selfDomain = selfEmail.split('@')[1] ?? '';

    try {
      const params = new URLSearchParams({
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        timeZone: range.timeZone,
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${access.accessToken}`,
          },
        },
      );
      if (!res.ok) {
        const body = await res.text();

        this.logger.warn(`Calendar events returned HTTP ${res.status} for org ${orgId}: ${body}`);

        return {
          configured: false,
          account: null,
          events: [],
          reason: `Google Calendar API error (HTTP ${res.status}). Reconnect the account and allow Calendar.`,
        };
      }

      const data = (await res.json()) as EventsListResponse;
      const events: CalendarEventDto[] = (data.items ?? [])
        .map((item) => {
          const start = item.start?.dateTime ?? item.start?.date ?? null;
          const end = item.end?.dateTime ?? item.end?.date ?? null;
          if (!item.id || !start || !end) return null;

          // External attendees only: drop the org's own self/account, anyone on the
          // org's own email domain, and room/resource entries.
          const attendees = (item.attendees ?? [])
            .filter((a) => !a.self && !a.resource && !!a.email)
            .map((a) => (a.email as string).toLowerCase())
            .filter(
              (email) =>
                email !== selfEmail && (selfDomain ? !email.endsWith(`@${selfDomain}`) : true),
            );

          return {
            id: item.id,
            title: item.summary ?? '(no title)',
            start,
            end,
            attendees,
            location: item.location ?? null,
            meetingUrl: item.hangoutLink ?? null,
          };
        })
        .filter((e): e is CalendarEventDto => e !== null);

      return {
        configured: true,
        account: { email: perOrg.account.email },
        events,
        reason: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Calendar upcoming failed for org ${orgId}: ${msg}`);
      return {
        configured: false,
        account: null,
        events: [],
        reason: 'Could not reach Google Calendar. Try again, or reconnect the account.',
      };
    }
  }

  // Proposed free slots over the next 7 days within Europe/Berlin business hours.
  // Never throws — returns a `configured: false` shell on any failure.
  async freeSlots(orgId: string, rangeInput: CalendarRangeInput = {}): Promise<CalendarFreeSlotsDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');
    if (!access.ok) {
      return { configured: false, slots: [], reason: access.reason };
    }
    const perOrg = access;
    const range = resolveCalendarRange(rangeInput);
    const durationMinutes = rangeInput.durationMinutes ?? 30;

    try {
      const now = new Date();
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${perOrg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: range.timeMin,
          timeMax: range.timeMax,
          timeZone: range.timeZone,
          items: [{ id: 'primary' }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();

        this.logger.warn(`Calendar freeBusy returned HTTP ${res.status} for org ${orgId}: ${body}`);

        return {
          configured: false,
          slots: [],
          reason: `Google Calendar API error (HTTP ${res.status}). Reconnect the account and allow Calendar.`,
        };
      }

      const data = (await res.json()) as FreeBusyResponse;
      const busyRaw =
        data.calendars?.primary?.busy ??
        // freeBusy echoes the requested id as the key; "primary" resolves to the
        // account's calendar id, so fall back to merging every returned calendar.
        Object.values(data.calendars ?? {}).flatMap((c) => c.busy ?? []);

      const busy: BusyInterval[] = busyRaw
        .map((b) => ({
          start: b.start ? Date.parse(b.start) : NaN,
          end: b.end ? Date.parse(b.end) : NaN,
        }))
        .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

      return { configured: true, slots: computeFreeSlots(busy, now), reason: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Calendar freeSlots failed for org ${orgId}: ${msg}`);
      return {
        configured: false,
        slots: [],
        reason: 'Could not reach Google Calendar. Try again, or reconnect the account.',
      };
    }
  }
  async createEvent(
    orgId: string,
    dto: CreateCalendarEventDto,
  ): Promise<CalendarMutationResultDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');

    if (!access.ok) {
      return {
        ok: false,
        eventId: null,
        htmlLink: null,
        meetingUrl: null,
        reason: access.reason,
      };
    }

    const body: Record<string, unknown> = {
      summary: dto.title,
      description: dto.description,
      location: dto.location,
      start: {
        dateTime: dto.start,
        timeZone: dto.timeZone,
      },
      end: {
        dateTime: dto.end,
        timeZone: dto.timeZone,
      },
      attendees: dto.attendees.map((a) => ({ email: a.email })),
    };

    const params = new URLSearchParams({
      sendUpdates: 'all',
    });

    if (dto.addGoogleMeet) {
      body.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
        },
      };
      params.set('conferenceDataVersion', '1');
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`Calendar create returned HTTP ${res.status} for org ${orgId}: ${err}`);

      return {
        ok: false,
        eventId: null,
        htmlLink: null,
        meetingUrl: null,
        reason: `Google Calendar create failed (HTTP ${res.status}).`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: { uri?: string }[];
      };
    };

    const meetingUrl =
      data.hangoutLink ?? data.conferenceData?.entryPoints?.find((p) => p.uri)?.uri ?? null;

    return {
      ok: true,
      eventId: data.id ?? null,
      htmlLink: data.htmlLink ?? null,
      meetingUrl,
      reason: null,
    };
  }
  async updateEvent(
    orgId: string,
    eventId: string,
    dto: UpdateCalendarEventDto,
  ): Promise<CalendarMutationResultDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');

    if (!access.ok) {
      return {
        ok: false,
        eventId: null,
        htmlLink: null,
        meetingUrl: null,
        reason: access.reason,
      };
    }

    const body: Record<string, unknown> = {};

    if (dto.title !== undefined) body.summary = dto.title;
    if (dto.description !== undefined) body.description = dto.description;
    if (dto.location !== undefined) body.location = dto.location;

    if (dto.start !== undefined) {
      body.start = {
        dateTime: dto.start,
        timeZone: dto.timeZone ?? 'Europe/Berlin',
      };
    }

    if (dto.end !== undefined) {
      body.end = {
        dateTime: dto.end,
        timeZone: dto.timeZone ?? 'Europe/Berlin',
      };
    }

    if (dto.attendees !== undefined) {
      body.attendees = dto.attendees.map((a) => ({ email: a.email }));
    }

    const params = new URLSearchParams({
      sendUpdates: 'all',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`Calendar update returned HTTP ${res.status} for org ${orgId}: ${err}`);

      return {
        ok: false,
        eventId: null,
        htmlLink: null,
        meetingUrl: null,
        reason: `Google Calendar update failed (HTTP ${res.status}).`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
    };

    return {
      ok: true,
      eventId: data.id ?? null,
      htmlLink: data.htmlLink ?? null,
      meetingUrl: data.hangoutLink ?? null,
      reason: null,
    };
  }
  async deleteEvent(
    orgId: string,
    eventId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');

    if (!access.ok) {
      return {
        ok: false,
        reason: access.reason,
      };
    }

    const params = new URLSearchParams({
      sendUpdates: 'all',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?${params.toString()}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
        },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`Calendar delete returned HTTP ${res.status} for org ${orgId}: ${err}`);

      return {
        ok: false,
        reason: `Google Calendar delete failed (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      reason: null,
    };
  }
}
