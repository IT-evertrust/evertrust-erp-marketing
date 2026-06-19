import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  isValidTimeZone,
  type CalendarEventCategory,
  type CalendarEventDto,
  type CalendarFreeSlotsDto,
  type CalendarUpcomingDto,
  type CalendarMutationResultDto,
  type CreateCalendarEventDto,
  type UpdateCalendarEventDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { AppConfigService } from '../config/app-config.service';
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

// Business-hours slot window, in the org's local sales timezone.
const BUSINESS_START_HOUR = 9; // 09:00 inclusive
const BUSINESS_END_HOUR = 17; // 17:00 exclusive (last slot starts 16:30)
const SLOT_MINUTES = 30;
const FREE_SLOT_HORIZON_DAYS = 7;
const MAX_FREE_SLOTS = 6;
const MAX_UPCOMING_EVENTS = 10;
// LAST-resort product default when an org has no salesTimeZone override and no
// SALES_TIME_ZONE env is set. Also the default for the pure slot generator so the
// existing Berlin-pinned unit tests stay green without passing a zone explicitly.
const DEFAULT_TIME_ZONE = 'Europe/Berlin';

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
    description?: string;
    location?: string;
    htmlLink?: string;
    hangoutLink?: string;
    status?: string;
    // Google event classification ('default' | 'outOfOffice' | 'focusTime' | ...).
    eventType?: string;
    // The user's chosen Google Calendar color for this event (1–11), or undefined.
    colorId?: string;

    creator?: {
      email?: string;
      displayName?: string;
      self?: boolean;
    };

    organizer?: {
      email?: string;
      displayName?: string;
      self?: boolean;
    };

    conferenceData?: {
      entryPoints?: {
        entryPointType?: string;
        uri?: string;
        label?: string;
        meetingCode?: string;
      }[];
    };

    start?: {
      dateTime?: string;
      date?: string;
      timeZone?: string;
    };

    end?: {
      dateTime?: string;
      date?: string;
      timeZone?: string;
    };

    attendees?: {
      email?: string;
      displayName?: string;
      self?: boolean;
      resource?: boolean;
      responseStatus?: string;
      optional?: boolean;
      organizer?: boolean;
    }[];
  }[];
}

// PURE category classifier for the Activate color code (exported for unit testing).
// Hybrid structural rules, FIRST MATCH WINS — no keyword guessing:
//   1. eventType 'outOfOffice'        → 'ooo'
//   2. all-day (Google start.date)     → 'reminder'
//   3. has an EXTERNAL attendee        → 'client'
//   4. has attendees, internal-only    → 'team'
//   5. otherwise (timed, no attendees) → 'personal'
// `selfDomain` is the org's own email domain (internal vs external test). Room/resource
// and self attendees never count as a "meeting".
export function classifyEvent(
  e: {
    eventType?: string;
    allDay: boolean;
    attendees: { email?: string; self?: boolean; resource?: boolean }[];
  },
  selfDomain: string,
): CalendarEventCategory {
  if (e.eventType === 'outOfOffice') return 'ooo';
  if (e.allDay) return 'reminder';
  const real = e.attendees.filter((a) => !a.self && !a.resource && !!a.email);
  if (real.length === 0) return 'personal';
  const hasExternal = real.some(
    (a) => !(selfDomain && (a.email as string).toLowerCase().endsWith(`@${selfDomain}`)),
  );
  return hasExternal ? 'client' : 'team';
}

// The local Y/M/D/H/M parts of an instant in an arbitrary IANA zone, DST-correct
// (uses the ICU tz database via Intl, so no tz library / no hardcoded offset).
function zoneParts(
  at: Date,
  tz: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
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

// The UTC instant for a given wall-clock time in an arbitrary IANA zone, DST-correct.
// We probe the zone's offset at a candidate UTC instant and correct once — sufficient
// outside the 1-hour DST fold, which never overlaps 09:00–17:00 business hours.
function zoneWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(asUtc);
  const p = zoneParts(probe, tz);
  const seenAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = seenAsUtc - asUtc; // how far local ran ahead of UTC at the probe
  return new Date(asUtc - offset);
}

// PURE slot computation (exported for unit testing). Given busy intervals and a
// reference `now`, returns up to `MAX_FREE_SLOTS` openings of `durationMinutes`
// (default 30) within weekday 09:00–17:00 business hours (in `tz`, default the product
// default) over the next `FREE_SLOT_HORIZON_DAYS` days. Slot START times stay on the
// 30-minute grid; a slot is free when it lies entirely in the future, finishes within
// business hours, and overlaps no busy interval. Deterministic and timezone-correct
// (DST-aware via Intl). `tz` defaults to the product default so existing Berlin-pinned
// callers/tests need no change.
export function computeFreeSlots(
  busy: BusyInterval[],
  now: Date = new Date(),
  tz: string = DEFAULT_TIME_ZONE,
  durationMinutes: number = SLOT_MINUTES,
): { start: string; end: string }[] {
  // The slot LENGTH honors the requested meeting duration; the start grid stays on
  // SLOT_MINUTES boundaries. Clamp to a sane positive value no longer than the
  // business window so a malformed/oversized request can't produce zero or nonsense.
  const businessWindowMinutes = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60;
  const duration =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? Math.min(Math.round(durationMinutes), businessWindowMinutes)
      : SLOT_MINUTES;
  const slotMs = duration * 60_000;
  const nowMs = now.getTime();
  const horizonMs = nowMs + FREE_SLOT_HORIZON_DAYS * 24 * 60 * 60_000;
  const out: { start: string; end: string }[] = [];

  // Walk each calendar day in the horizon by its local date in `tz`, generating
  // candidate slots within business hours. Iterate by UTC-midnight steps but resolve
  // each business-hour slot through the zone's wall clock so DST shifts stay correct.
  for (let dayOffset = 0; dayOffset <= FREE_SLOT_HORIZON_DAYS; dayOffset++) {
    const probe = new Date(nowMs + dayOffset * 24 * 60 * 60_000);
    const { year, month, day, weekday } = zoneParts(probe, tz);

    // Weekdays only (Mon–Fri).
    if (weekday === 0 || weekday === 6) continue;

    // The day's close as a UTC instant — a longer slot may start within business
    // hours yet must not run past it (e.g. a 60-min slot can't start at 16:30).
    const businessEndMs = zoneWallClockToUtc(year, month, day, BUSINESS_END_HOUR, 0, tz).getTime();

    for (let h = BUSINESS_START_HOUR; h < BUSINESS_END_HOUR; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        const startDate = zoneWallClockToUtc(year, month, day, h, m, tz);
        const startMs = startDate.getTime();
        const endMs = startMs + slotMs;

        if (startMs < nowMs) continue; // only future slots
        if (startMs >= horizonMs) continue; // within the 7-day horizon
        if (endMs > businessEndMs) continue; // must finish within business hours

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

function resolveCalendarRange(
  input: CalendarRangeInput = {},
  defaultTimeZone: string = DEFAULT_TIME_ZONE,
) {
  const timeZone = input.timeZone || defaultTimeZone;

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

  constructor(
    private readonly googleAccounts: GoogleAccountsService,
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
  ) {}

  // The CALLING org's resolved calendar timezones, per the multi-tenant rule
  // (org value ?? env default). `primary` always resolves to a valid IANA zone
  // (org_config.salesTimeZone ?? env SALES_TIME_ZONE ?? 'Europe/Berlin'); `secondary`
  // is the org's optional dual-scale gutter zone (org_config.salesSecondaryTimeZone)
  // or null. Invalid stored/env zones are ignored (degrade to the default) — this
  // powers a page load and must never throw.
  private async resolveOrgTimeZones(
    orgId: string,
  ): Promise<{ primary: string; secondary: string | null }> {
    let primary = DEFAULT_TIME_ZONE;
    let secondary: string | null = null;

    try {
      const rows = await this.db
        .select({
          salesTimeZone: schema.orgConfig.salesTimeZone,
          salesSecondaryTimeZone: schema.orgConfig.salesSecondaryTimeZone,
        })
        .from(schema.orgConfig)
        .where(eq(schema.orgConfig.organizationId, orgId))
        .limit(1);
      const row = rows[0];

      const orgPrimary = row?.salesTimeZone?.trim();
      const envPrimary = this.config.get('SALES_TIME_ZONE').trim();
      const candidate =
        (orgPrimary && orgPrimary.length > 0 ? orgPrimary : null) ??
        (envPrimary.length > 0 ? envPrimary : null);
      if (candidate && isValidTimeZone(candidate)) primary = candidate;

      const orgSecondary = row?.salesSecondaryTimeZone?.trim();
      if (orgSecondary && orgSecondary.length > 0 && isValidTimeZone(orgSecondary)) {
        secondary = orgSecondary;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`resolveOrgTimeZones failed for org ${orgId}: ${msg}`);
    }

    return { primary, secondary };
  }

  // The next upcoming real events from the org's primary calendar. Never throws —
  // returns a `configured: false` shell when the org has no default calendar mailbox
  // or Google is unreachable.
  async upcoming(orgId: string, rangeInput: CalendarRangeInput = {}): Promise<CalendarUpcomingDto> {
    const { primary: timeZone, secondary: secondaryTimeZone } =
      await this.resolveOrgTimeZones(orgId);
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');
    if (!access.ok) {
      return {
        configured: false,
        account: null,
        events: [],
        reason: access.reason,
        timeZone,
        secondaryTimeZone,
      };
    }
    const perOrg = access;
    const range = resolveCalendarRange(rangeInput, timeZone);
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
          timeZone,
          secondaryTimeZone,
        };
      }

      const data = (await res.json()) as EventsListResponse;

      const events = (data.items ?? []).flatMap((item): CalendarEventDto[] => {
        const id = item.id;
        const start = item.start?.dateTime ?? item.start?.date ?? null;
        const end = item.end?.dateTime ?? item.end?.date ?? null;

        if (!id || !start || !end) {
          return [];
        }

        // External attendees only: drop the org's own self/account, anyone on the
        // org's own email domain, and room/resource entries.
        const attendees = (item.attendees ?? [])
          .filter((a) => !a.self && !a.resource && !!a.email)
          .map((a) => (a.email as string).toLowerCase())
          .filter(
            (email) =>
              email !== selfEmail && (selfDomain ? !email.endsWith(`@${selfDomain}`) : true),
          );

        const videoEntry = item.conferenceData?.entryPoints?.find(
          (entryPoint) => entryPoint.entryPointType === 'video' && !!entryPoint.uri,
        );

        const firstConferenceEntry = item.conferenceData?.entryPoints?.find(
          (entryPoint) => !!entryPoint.uri,
        );

        const meetingUrl = item.hangoutLink ?? videoEntry?.uri ?? firstConferenceEntry?.uri ?? null;

        const event: CalendarEventDto = {
          id,
          title: item.summary ?? '(no title)',
          start,
          end,
          attendees,

          // Google Calendar details popup fields.
          description: item.description ?? null,
          location: item.location ?? null,
          htmlLink: item.htmlLink ?? null,
          status: item.status ?? null,
          organizerEmail: item.organizer?.email ?? null,
          creatorEmail: item.creator?.email ?? null,

          // Google Meet / conference link.
          meetingUrl,
        };

        return [event];
      });

      return {
        configured: true,
        account: { email: perOrg.account.email },
        events,
        reason: null,
        timeZone,
        secondaryTimeZone,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Calendar upcoming failed for org ${orgId}: ${msg}`);
      return {
        configured: false,
        account: null,
        events: [],
        reason: 'Could not reach Google Calendar. Try again, or reconnect the account.',
        timeZone,
        secondaryTimeZone,
      };
    }
  }

  // Proposed free slots over the next 7 days within Europe/Berlin business hours.
  // Never throws — returns a `configured: false` shell on any failure.
  async freeSlots(orgId: string, rangeInput: CalendarRangeInput = {}): Promise<CalendarFreeSlotsDto> {
    const { primary: timeZone, secondary: secondaryTimeZone } =
      await this.resolveOrgTimeZones(orgId);
    const access = await this.googleAccounts.resolveMailbox(orgId, 'calendar');
    if (!access.ok) {
      return { configured: false, slots: [], reason: access.reason, timeZone, secondaryTimeZone };
    }
    const perOrg = access;
    const range = resolveCalendarRange(rangeInput, timeZone);
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
          timeZone,
          secondaryTimeZone,
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

      return {
        configured: true,
        slots: computeFreeSlots(busy, now, timeZone, durationMinutes),
        reason: null,
        timeZone,
        secondaryTimeZone,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Calendar freeSlots failed for org ${orgId}: ${msg}`);
      return {
        configured: false,
        slots: [],
        reason: 'Could not reach Google Calendar. Try again, or reconnect the account.',
        timeZone,
        secondaryTimeZone,
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

    // Default the wall-clock timezone to the org's resolved primary zone (per-org,
    // never a hardcoded EverTrust value) when the caller doesn't supply one.
    const { primary: defaultTimeZone } = await this.resolveOrgTimeZones(orgId);

    if (dto.start !== undefined) {
      body.start = {
        dateTime: dto.start,
        timeZone: dto.timeZone ?? defaultTimeZone,
      };
    }

    if (dto.end !== undefined) {
      body.end = {
        dateTime: dto.end,
        timeZone: dto.timeZone ?? defaultTimeZone,
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
