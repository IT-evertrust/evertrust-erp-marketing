import { Injectable, Logger } from '@nestjs/common';

import { GoogleAuthService } from '../../../auth/google/google-auth.service';
import type { ActivateMeeting } from '../activate/activate.model';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

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
// tokens (info | hanna) come from GoogleAuthService; the calendar id is always 'primary'
// (the token already scopes to that account). Unusable/absent grants degrade to an empty
// list so the caller can fall back to DB-seeded meetings — the Booker never crashes.
@Injectable()
export class CalendarReaderService {
  private readonly logger = new Logger(CalendarReaderService.name);

  constructor(private readonly google: GoogleAuthService) {}

  // Events for an account across a window (default: last 2 weeks → next 10 weeks, so the
  // Booker can page prev/next weeks). [] if the grant is unusable.
  async listUpcoming(
    orgId: string,
    accountId: string,
    fromDays = -14,
    toDays = 70,
  ): Promise<ActivateMeeting[]> {
    const token = await this.google.getAccessTokenForAccountId(orgId, accountId);
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
    const token = await this.google.getAccessTokenForAccountId(orgId, accountId);
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
