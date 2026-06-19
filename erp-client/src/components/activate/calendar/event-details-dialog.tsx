'use client';

import { type ReactNode, useEffect } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  formatClockInTimeZone,
  zoneShortLabel,
} from '@/components/activate/calendar/time-grid';
import {
  getEventString,
  stripHtml,
} from '@/components/activate/calendar/event-block';
import type { CalendarGridEvent } from '@/components/activate/calendar/types';

export function CalendarEventDetailsDialog({
  event,
  onClose,
  primaryTz,
  secondaryTz,
}: {
  event: CalendarGridEvent | null;
  onClose: () => void;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const t = useTranslations('activate');
  const format = useFormatter();

  useEffect(() => {
    if (!event) return;

    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [event, onClose]);

  if (!event) {
    return null;
  }

  const title = event.title || t('book.upcoming.untitled');
  const attendees = event.attendees ?? [];

  const primaryLabel = zoneShortLabel(primaryTz);
  const primaryDate = format.dateTime(event.startDate, {
    timeZone: primaryTz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const primaryFrom = formatClockInTimeZone(event.startDate, primaryTz);
  const primaryTo = formatClockInTimeZone(event.endDate, primaryTz);

  const secondaryLabel = secondaryTz ? zoneShortLabel(secondaryTz) : null;
  const secondaryDate = secondaryTz
    ? format.dateTime(event.startDate, {
        timeZone: secondaryTz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const secondaryFrom = secondaryTz ? formatClockInTimeZone(event.startDate, secondaryTz) : null;
  const secondaryTo = secondaryTz ? formatClockInTimeZone(event.endDate, secondaryTz) : null;

  const location = getEventString(event, 'location');
  const rawDescription = getEventString(event, 'description');
  const description = rawDescription ? stripHtml(rawDescription) : null;

  const htmlLink =
    getEventString(event, 'htmlLink') ??
    getEventString(event, 'googleCalendarUrl') ??
    getEventString(event, 'calendarUrl');

  const organizer =
    getEventString(event, 'organizerEmail') ?? getEventString(event, 'creatorEmail');

  const status = getEventString(event, 'status');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-500">
              <Calendar className="size-3" />
              Google Calendar event
            </div>

            <h2 className="break-words text-lg font-semibold leading-snug">{title}</h2>
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label="Close meeting details"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <EventDetailRow icon={<Clock className="size-4" />} label="Time">
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                {primaryDate}, {primaryFrom}–{primaryTo}
              </span>
              <span className="text-xs text-muted-foreground">{primaryLabel}</span>
              {secondaryTz ? (
                <span className="text-xs text-muted-foreground">
                  {secondaryLabel}: {secondaryDate}, {secondaryFrom}–{secondaryTo}
                </span>
              ) : null}
            </div>
          </EventDetailRow>

          {location ? (
            <EventDetailRow icon={<MapPin className="size-4" />} label="Location">
              <span className="break-words">{location}</span>
            </EventDetailRow>
          ) : null}

          <EventDetailRow icon={<Users className="size-4" />} label="Guests">
            {attendees.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attendees.map((attendee) => (
                  <span key={attendee} className="rounded-full border bg-muted px-2 py-1 text-xs">
                    {attendee}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">{t('book.upcoming.noAttendees')}</span>
            )}
          </EventDetailRow>

          {organizer ? (
            <EventDetailRow icon={<Mail className="size-4" />} label="Organizer">
              <span className="break-words">{organizer}</span>
            </EventDetailRow>
          ) : null}

          {event.meetingUrl ? (
            <EventDetailRow icon={<Video className="size-4" />} label="Meeting link">
              <Button asChild size="sm" variant="outline">
                <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
                  <Video className="size-3.5" />
                  {t('book.upcoming.join')}
                </a>
              </Button>
            </EventDetailRow>
          ) : null}

          {description ? (
            <EventDetailRow icon={<FileText className="size-4" />} label="Description">
              <p className="whitespace-pre-wrap break-words leading-relaxed">{description}</p>
            </EventDetailRow>
          ) : null}

          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="block font-semibold text-foreground">Event ID</span>
              <span className="break-all">{event.id}</span>
            </div>

            <div>
              <span className="block font-semibold text-foreground">Status</span>
              <span>{status ?? 'confirmed / unknown'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4">
          {htmlLink ? (
            <Button asChild size="sm" variant="outline">
              <a href={htmlLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                Open in Google Calendar
              </a>
            </Button>
          ) : null}

          {event.meetingUrl ? (
            <Button asChild size="sm">
              <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
                <Video className="size-3.5" />
                Join meeting
              </a>
            </Button>
          ) : null}

          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventDetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[20px_1fr] gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>

      <div className="min-w-0">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>

        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}
