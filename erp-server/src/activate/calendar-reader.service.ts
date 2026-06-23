import { Injectable, Logger } from '@nestjs/common';

import { GoogleAccountsService } from '../google/google-accounts.service';
import type { ActivateMeeting } from './activate.model';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_TZ = 'Europe/Berlin';

// Raw Google Calendar event (the subset we read).
interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}

// Reads a connected mailbox's Google Calendar for the Activate Meeting Booker. Per-account
// tokens (info | hanna) come from GoogleAccountsService; the calendar id is always 'primary'
// (the token already scopes to that account). Unusable/absent grants degrade to an empty
// list so the caller can fall back to DB-seeded meetings — the Booker never crashes.
@Injectable()
export class CalendarReaderService {
  private readonly logger = new Logger(CalendarReaderService.name);

  constructor(private readonly google: GoogleAccountsService) {}

  // Events for an account across a window (default: last 2 weeks → next 10 weeks, so the
  // Booker can page prev/next weeks). [] if the grant is unusable.
  async listUpcoming(
    orgId: string,
    accountId: string,
    fromDays = -14,
    toDays = 70,
  ): Promise<ActivateMeeting[]> {
    const token = await this.google.getAccessTokenForAccount(orgId, accountId);
    if (!token) return [];
    const now = Date.now();
    const params = new URLSearchParams({
      timeMin: new Date(now + fromDays * 86_400_000).toISOString(),
      timeMax: new Date(now + toDays * 86_400_000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });
    try {
      const res = await fetch(
        `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        this.logger.warn(
          `Calendar list failed for account ${accountId}: ${res.status}`,
        );
        return [];
      }
      const json = (await res.json()) as { items?: GCalEvent[] };
      return (json.items ?? [])
        .filter((e) => e.status !== 'cancelled')
        .map((e) => mapEvent(e));
    } catch (err) {
      this.logger.warn(
        `Calendar read error for account ${accountId}: ${err instanceof Error ? err.message : 'error'}`,
      );
      return [];
    }
  }

  // One event's detail. null if the grant is unusable or the event is gone.
  async getEvent(
    orgId: string,
    accountId: string,
    eventId: string,
  ): Promise<ActivateMeeting | null> {
    const token = await this.google.getAccessTokenForAccount(orgId, accountId);
    if (!token) return null;
    try {
      const res = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const event = (await res.json()) as GCalEvent;
      return mapEvent(event);
    } catch {
      return null;
    }
  }

  // Edit an event IN PLACE on an account's calendar (title/time/location/notes). Returns
  // the updated meeting, or null if the grant is unusable / the API rejects.
  async updateEvent(
    orgId: string,
    accountId: string,
    eventId: string,
    patch: {
      title?: string;
      description?: string | null;
      location?: string | null;
      start?: string;
      end?: string;
    },
  ): Promise<ActivateMeeting | null> {
    const token = await this.google.getAccessTokenForAccount(orgId, accountId);
    if (!token) return null;
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.start !== undefined) body.start = { dateTime: patch.start, timeZone: DEFAULT_TZ };
    if (patch.end !== undefined) body.end = { dateTime: patch.end, timeZone: DEFAULT_TZ };
    try {
      const res = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Calendar update failed (${accountId}/${eventId}): ${res.status}`);
        return null;
      }
      return mapEvent((await res.json()) as GCalEvent);
    } catch (err) {
      this.logger.warn(`Calendar update error: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }

  // MOVE an event from one connected account's calendar to ANOTHER. Google's native
  // events.move only works within one account, so across accounts (different OAuth
  // tokens) we COPY the event onto the target calendar then delete it from the source.
  // Returns the new meeting on the target account, or null on failure (source is left
  // intact if the copy fails, so we never lose the meeting).
  async moveEvent(
    orgId: string,
    eventId: string,
    fromAccountId: string,
    toAccountId: string,
  ): Promise<ActivateMeeting | null> {
    const fromToken = await this.google.getAccessTokenForAccount(orgId, fromAccountId);
    const toToken = await this.google.getAccessTokenForAccount(orgId, toAccountId);
    if (!fromToken || !toToken) return null;
    try {
      const getRes = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${fromToken}` } },
      );
      if (!getRes.ok) return null;
      const ev = (await getRes.json()) as GCalEvent;

      const body = {
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        start: ev.start,
        end: ev.end,
        // Re-invite the external attendees (drop the source self entry).
        attendees: (ev.attendees ?? [])
          .filter((a) => !a.self && a.email)
          .map((a) => ({ email: a.email })),
      };
      const createRes = await fetch(
        `${CALENDAR_API}/calendars/primary/events?sendUpdates=all`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${toToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!createRes.ok) {
        this.logger.warn(`Calendar move copy failed (${toAccountId}): ${createRes.status}`);
        return null; // source preserved
      }
      const created = (await createRes.json()) as GCalEvent;

      // Copy succeeded — remove the original from the source account.
      await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${fromToken}` } },
      ).catch(() => undefined);

      return mapEvent(created);
    } catch (err) {
      this.logger.warn(`Calendar move error: ${err instanceof Error ? err.message : 'error'}`);
      return null;
    }
  }
}

// ---- mapping: Google event -> the Booker's ActivateMeeting shape ----

function mapEvent(e: GCalEvent): ActivateMeeting {
  const startsAt = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
  const endsAt = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
  const durationMinutes =
    startsAt && endsAt
      ? Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000))
      : null;

  const client = pickClient(e);
  const joinUrl =
    e.hangoutLink ??
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ??
    null;

  return {
    id: e.id,
    day: dayLabel(startsAt),
    time: timeLabel(startsAt, e.start?.date != null),
    company: client.company || e.summary || 'Meeting',
    contact: client.contact || '',
    title: e.summary ?? 'Meeting',
    startsAt,
    endsAt,
    durationMinutes,
    location: e.location ?? null,
    description: e.description ?? null,
    joinUrl,
    htmlLink: e.htmlLink ?? null,
    attendees: (e.attendees ?? []).map((a) => ({
      name: a.displayName ?? null,
      email: a.email ?? null,
      responseStatus: a.responseStatus ?? null,
    })),
    organizer: e.organizer?.email ?? null,
  };
}

// The "client" of a meeting = the first external attendee (not self, not the organizer).
// Company is derived from their email domain, contact from their display name.
function pickClient(e: GCalEvent): { company: string; contact: string } {
  const external = (e.attendees ?? []).find(
    (a) => !a.self && !a.organizer && a.email,
  );
  const picked = external ?? (e.attendees ?? []).find((a) => !a.self && a.email);
  if (!picked) return { company: '', contact: e.organizer?.displayName ?? '' };
  return {
    company: companyFromEmail(picked.email),
    contact: picked.displayName ?? picked.email ?? '',
  };
}

function companyFromEmail(email?: string): string {
  if (!email || !email.includes('@')) return '';
  const domain = email.split('@')[1]?.split('.')[0];
  if (!domain) return '';
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

function dayLabel(iso: string | null): string {
  if (!iso) return 'Upcoming';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Upcoming';
  const weekday = d
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' })
    .toUpperCase();
  const dom = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Europe/Berlin' });
  return `${weekday} ${dom}`;
}

function timeLabel(iso: string | null, allDay: boolean): string {
  if (allDay) return 'All day';
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Berlin',
  });
}
