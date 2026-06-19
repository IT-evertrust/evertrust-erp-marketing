'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, Users, Video } from 'lucide-react';
import type { CalendarEventDto } from '@evertrust/shared';
import {
  formatClockInTimeZone,
  getVisualRangeForDateKey,
  minuteRangeToHeight,
  minuteToTop,
  zoneShortLabel,
} from '@/components/activate/calendar/time-grid';
import type {
  CalendarEventLayout,
  CalendarGridEvent,
  LaidOutCalendarEvent,
} from '@/components/activate/calendar/types';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';

export function CalendarEventBlock({
  dayKey,
  event,
  selected,
  onSelect,
  primaryTz,
  secondaryTz,
}: {
  dayKey: string;
  event: LaidOutCalendarEvent;
  selected: boolean;
  onSelect: () => void;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const t = useTranslations('activate');

  const visual = getVisualRangeForDateKey(event.startDate, event.endDate, dayKey, primaryTz);

  const top = minuteToTop(visual.startMinute);
  const height = minuteRangeToHeight(visual.startMinute, visual.endMinute);
  const style = getEventBlockStyle(event.layout, top, height);

  const primaryLabel = zoneShortLabel(primaryTz);
  const primaryFrom = formatClockInTimeZone(event.startDate, primaryTz);
  const primaryTo = formatClockInTimeZone(event.endDate, primaryTz);
  const secondaryLabel = secondaryTz ? zoneShortLabel(secondaryTz) : null;
  const secondaryFrom = secondaryTz ? formatClockInTimeZone(event.startDate, secondaryTz) : null;
  const secondaryTo = secondaryTz ? formatClockInTimeZone(event.endDate, secondaryTz) : null;

  const title = event.title || t('book.upcoming.untitled');
  const attendees = event.attendees ?? [];

  const attendeeLabel =
    attendees.length > 0 ? attendees.join(', ') : t('book.upcoming.noAttendees');

  const compact = height < 54;
  const roomy = height >= 78;

  const categoryStyle = CATEGORY_STYLE[event.category];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'absolute z-20 overflow-hidden rounded-lg border border-border border-l-4 bg-popover px-2 py-1.5 text-left text-popover-foreground shadow-lg transition',
        categoryStyle.bar,
        'hover:-translate-y-0.5 hover:bg-muted hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'ring-2 ring-ring' : '',
      ].join(' ')}
      style={style}
      title={
        secondaryTz
          ? `${title} · ${primaryLabel} ${primaryFrom}–${primaryTo} · ${secondaryLabel} ${secondaryFrom}–${secondaryTo}`
          : `${title} · ${primaryLabel} ${primaryFrom}–${primaryTo}`
      }
      aria-label={t('calendar.event.aria', {
        title,
        zone: primaryLabel,
        from: primaryFrom,
        to: primaryTo,
      })}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
        <Clock className="size-3 shrink-0" />
        <span className="truncate tabular-nums">
          {primaryLabel} {primaryFrom}–{primaryTo}
        </span>
      </div>

      <div className={`truncate text-xs font-semibold leading-tight ${categoryStyle.tint}`}>
        {title}
      </div>

      {!compact && secondaryTz ? (
        <div className="truncate text-[10px] font-medium text-muted-foreground">
          {secondaryLabel} {secondaryFrom}–{secondaryTo}
        </div>
      ) : null}

      {roomy ? (
        <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
          <Users className="size-3 shrink-0" />
          <span className="truncate">{attendeeLabel}</span>
        </div>
      ) : null}

      {roomy && event.meetingUrl ? (
        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-500">
          <Video className="size-3" />
          {t('calendar.event.meet')}
        </div>
      ) : null}
    </button>
  );
}

export function layoutDayEvents(
  events: CalendarGridEvent[],
  dayKey: string,
  timeZone: string,
): LaidOutCalendarEvent[] {
  type LayoutItem = {
    event: CalendarGridEvent;
    startMinute: number;
    endMinute: number;
    column?: number;
  };

  const items: LayoutItem[] = events
    .map((event) => {
      const visual = getVisualRangeForDateKey(
        event.startDate,
        event.endDate,
        dayKey,
        timeZone,
      );

      return {
        event,
        startMinute: visual.startMinute,
        endMinute: visual.endMinute,
      };
    })
    .sort((a, b) => {
      if (a.startMinute !== b.startMinute) {
        return a.startMinute - b.startMinute;
      }

      return b.endMinute - a.endMinute;
    });

  const laidOut: LaidOutCalendarEvent[] = [];
  let cluster: LayoutItem[] = [];
  let clusterEndMinute = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;

    const columnEndMinutes: number[] = [];

    for (const item of cluster) {
      let column = columnEndMinutes.findIndex((endMinute) => endMinute <= item.startMinute);

      if (column === -1) {
        column = columnEndMinutes.length;
      }

      columnEndMinutes[column] = item.endMinute;
      item.column = column;
    }

    const columns = Math.max(1, columnEndMinutes.length);

    for (const item of cluster) {
      laidOut.push({
        ...item.event,
        layout: {
          column: item.column ?? 0,
          columns,
        },
      });
    }

    cluster = [];
    clusterEndMinute = -1;
  };

  for (const item of items) {
    if (cluster.length === 0) {
      cluster = [item];
      clusterEndMinute = item.endMinute;
      continue;
    }

    if (item.startMinute < clusterEndMinute) {
      cluster.push(item);
      clusterEndMinute = Math.max(clusterEndMinute, item.endMinute);
      continue;
    }

    flushCluster();

    cluster = [item];
    clusterEndMinute = item.endMinute;
  }

  flushCluster();

  return laidOut;
}

export function getEventBlockStyle(
  layout: CalendarEventLayout,
  top: number,
  height: number,
): CSSProperties {
  const columns = Math.max(1, layout.columns);
  const column = Math.min(layout.column, columns - 1);

  const columnWidth = 100 / columns;
  const horizontalGap = 6;

  return {
    top,
    height,
    left: `calc(${column * columnWidth}% + ${horizontalGap}px)`,
    width: `calc(${columnWidth}% - ${horizontalGap * 2}px)`,
  };
}

export function getEventString(event: CalendarEventDto, key: string): string | null {
  const value = (event as unknown as Record<string, unknown>)[key];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
