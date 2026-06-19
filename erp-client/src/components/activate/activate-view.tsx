'use client';

import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Mic,
  Search,
  Users,
  Video,
  X,
} from 'lucide-react';
import type {
  CalendarEventDto,
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
} from '@evertrust/shared';
import { useCalendarFreeSlots, useCalendarUpcoming } from '@/hooks/use-meetings';
import { AccountBar } from '@/components/rean/account-bar';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// Bootstrap/product-default zone used only until the org's resolved timezone arrives
// from the calendar API. The org's actual primary/secondary zones (org_config) drive
// all rendering — see primaryTz / secondaryTz threaded from the calendar payload.
const DEFAULT_TIME_ZONE = 'Europe/Berlin';

const HOUR_HEIGHT = 72;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WORK_WEEK_DAYS = 5;

type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');

  const [tab, setTab] = useState<ActivateTab>('book');

  const [calendarWeekStartKey, setCalendarWeekStartKey] = useState(() =>
    startOfWorkWeekKey(new Date(), DEFAULT_TIME_ZONE),
  );

  const calendarRange = useMemo(() => {
    // Fetch a buffered window (±1 day) around the visible work week so no event is
    // clipped at the week edge regardless of the org's render zone (the grid re-buckets
    // events into days using the resolved org zone). The fetch window is zone-agnostic;
    // timeZone here only tags the request.
    const timeMin = zonedTimeToUtcDate(
      addDaysToDateKey(calendarWeekStartKey, -1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    const timeMax = zonedTimeToUtcDate(
      addDaysToDateKey(calendarWeekStartKey, WORK_WEEK_DAYS + 1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: DEFAULT_TIME_ZONE,
    };
  }, [calendarWeekStartKey]);

  const upcoming = useCalendarUpcoming(calendarRange);

  const freeSlots = useCalendarFreeSlots({
    ...calendarRange,
    durationMinutes: 30,
  });

  // The org's RESOLVED calendar zones (org_config ?? product default), carried on the
  // calendar payload. `primaryTz` always present; `secondaryTz` null = single time scale.
  const primaryTz =
    upcoming.data?.timeZone ?? freeSlots.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const secondaryTz =
    upcoming.data?.secondaryTimeZone ?? freeSlots.data?.secondaryTimeZone ?? null;

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);

  const email = upcoming.data?.account?.email ?? null;

  const service = (
    <>
      <Calendar className="size-3.5" />
      {configured && email ? t('account.connected', { email }) : t('account.service')}
    </>
  );

  const stats =
    upcoming.isLoading || freeSlots.isLoading
      ? t('account.statsLoading')
      : upcoming.isError || freeSlots.isError
        ? t('account.statsError')
        : t('account.stats', {
            meetings: upcoming.data?.events.length ?? 0,
            slots: freeSlots.data?.slots.length ?? 0,
          });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />

      <AccountBar service={service} mailboxes={[]} connected={configured} stats={stats} />

      <SegmentedTabs
        value={tab}
        onValueChange={(v) => setTab(v as ActivateTab)}
        tabs={[
          {
            value: 'book',
            label: t('tabs.book'),
            icon: <CalendarDays className="size-4" />,
          },
          {
            value: 'research',
            label: t('tabs.research'),
            icon: <Search className="size-4" />,
          },
          {
            value: 'after',
            label: t('tabs.after'),
            icon: <Mic className="size-4" />,
          },
        ]}
      />

      {tab === 'book' ? (
        <BookTab
          upcoming={upcoming}
          freeSlots={freeSlots}
          weekStartKey={calendarWeekStartKey}
          onWeekStartKeyChange={setCalendarWeekStartKey}
          primaryTz={primaryTz}
          secondaryTz={secondaryTz}
        />
      ) : tab === 'research' ? (
        <EmptyState
          icon={<Search />}
          title={t('research.comingSoon')}
          description={t('research.comingSoonBody')}
        />
      ) : (
        <EmptyState
          icon={<Mic />}
          title={t('after.comingSoon')}
          description={t('after.comingSoonBody')}
        />
      )}
    </div>
  );
}

type UpcomingQuery = {
  data?: CalendarUpcomingDto;
  isLoading: boolean;
  isError: boolean;
};

type FreeSlotsQuery = {
  data?: CalendarFreeSlotsDto;
  isLoading: boolean;
  isError: boolean;
};

type CalendarGridEvent = CalendarEventDto & {
  startDate: Date;
  endDate: Date;
};

type CalendarGridSlot = {
  start: Date;
  end: Date;
};

type CalendarEventLayout = {
  column: number;
  columns: number;
};

type LaidOutCalendarEvent = CalendarGridEvent & {
  layout: CalendarEventLayout;
};

function ConnectHint({ reason }: { reason?: string | null }) {
  const t = useTranslations('activate');

  return (
    <EmptyState
      icon={<CalendarX />}
      title={t('book.notConnectedTitle')}
      description={reason ?? t('book.notConnectedBody')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/configuration">{t('book.connectCta')}</Link>
        </Button>
      }
    />
  );
}

function BookTab({
  upcoming,
  freeSlots,
  weekStartKey,
  onWeekStartKeyChange,
  primaryTz,
  secondaryTz,
}: {
  upcoming: UpcomingQuery;
  freeSlots: FreeSlotsQuery;
  weekStartKey: string;
  onWeekStartKeyChange: Dispatch<SetStateAction<string>>;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const t = useTranslations('activate');
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<CalendarGridEvent | null>(null);

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);

  const reason = upcoming.data?.reason ?? freeSlots.data?.reason ?? null;

  const days = useMemo(
    () => Array.from({ length: WORK_WEEK_DAYS }, (_, i) => addDaysToDateKey(weekStartKey, i)),
    [weekStartKey],
  );

  const weekEndKey = useMemo(() => addDaysToDateKey(weekStartKey, WORK_WEEK_DAYS), [weekStartKey]);

  const gridEvents = useMemo<CalendarGridEvent[]>(() => {
    return (upcoming.data?.events ?? [])
      .map((event) => {
        const startDate = new Date(event.start);
        const endDate = new Date(event.end);

        return {
          ...event,
          startDate,
          endDate,
        };
      })
      .filter((event) => {
        if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) {
          return false;
        }

        return overlapsDateKeyRange(
          event.startDate,
          event.endDate,
          weekStartKey,
          weekEndKey,
          primaryTz,
        );
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [upcoming.data?.events, weekStartKey, weekEndKey, primaryTz]);

  const gridSlots = useMemo<CalendarGridSlot[]>(() => {
    return (freeSlots.data?.slots ?? [])
      .map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
      .filter((slot) => {
        if (!isValidDate(slot.start) || !isValidDate(slot.end)) {
          return false;
        }

        return overlapsDateKeyRange(
          slot.start,
          slot.end,
          weekStartKey,
          weekEndKey,
          primaryTz,
        );
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [freeSlots.data?.slots, weekStartKey, weekEndKey, primaryTz]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 6 * HOUR_HEIGHT - 10;
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [weekStartKey]);

  const weekRange = `${format.dateTime(dateKeyToUtcDate(weekStartKey), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  })} – ${format.dateTime(dateKeyToUtcDate(addDaysToDateKey(weekStartKey, WORK_WEEK_DAYS - 1)), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  })}`;

  if (upcoming.isLoading || freeSlots.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[420px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (upcoming.isError || freeSlots.isError) {
    return (
      <Card>
        <CardContent className="py-10">
          <p className="text-center text-sm text-muted-foreground">{t('book.upcoming.error')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!configured) {
    return <ConnectHint reason={reason} />;
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-semibold">
              Calendar · Week {getIsoWeekNumber(weekStartKey)}
            </CardTitle>

            <p className="mt-1 text-xs text-muted-foreground">
              {gridEvents.length} meetings · {gridSlots.length} proposed free slots
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-8"
                aria-label="Previous week"
                onClick={() => onWeekStartKeyChange((key) => addDaysToDateKey(key, -7))}
              >
                <ChevronLeft className="size-4" />
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() =>
                  onWeekStartKeyChange(startOfWorkWeekKey(new Date(), primaryTz))
                }
              >
                Today
              </Button>

              <span className="min-w-28 text-center text-xs font-semibold text-muted-foreground">
                {weekRange}
              </span>

              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-8"
                aria-label="Next week"
                onClick={() => onWeekStartKeyChange((key) => addDaysToDateKey(key, 7))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Google Calendar connected
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="flex h-[calc(100vh-300px)] min-h-[480px] min-w-[980px] flex-col">
              <div className="flex border-b pr-2">
                <TimeScaleHeader primaryTz={primaryTz} secondaryTz={secondaryTz} />

                {days.map((dayKey) => {
                  const dayEvents = gridEvents.filter((event) =>
                    overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
                  );

                  const daySlots = gridSlots.filter((slot) =>
                    overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
                  );

                  return (
                    <div
                      key={dayKey}
                      className="flex flex-1 flex-col items-center border-l py-2 text-center"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {format.dateTime(dateKeyToUtcDate(dayKey), {
                          timeZone: 'UTC',
                          weekday: 'short',
                        })}
                      </span>

                      <span className="text-[10px] font-medium text-muted-foreground">
                        {format.dateTime(dateKeyToUtcDate(dayKey), {
                          timeZone: 'UTC',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>

                      <span className="mt-1 text-[10px] text-muted-foreground">
                        {dayEvents.length > 0
                          ? `${dayEvents.length} ${dayEvents.length === 1 ? 'meeting' : 'meetings'}`
                          : daySlots.length > 0
                            ? `${daySlots.length} ${daySlots.length === 1 ? 'slot' : 'slots'}`
                            : 'free'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                ref={scrollRef}
                className="flex flex-1 items-start overflow-y-auto overflow-x-hidden"
              >
                <TimeScaleColumns
                  sampleDayKey={weekStartKey}
                  primaryTz={primaryTz}
                  secondaryTz={secondaryTz}
                />

                {days.map((dayKey) => (
                  <DayColumn
                    key={dayKey}
                    dayKey={dayKey}
                    events={gridEvents.filter((event) =>
                      overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
                    )}
                    slots={gridSlots.filter((slot) =>
                      overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
                    )}
                    selectedEventId={selectedEvent?.id ?? null}
                    onSelectEvent={setSelectedEvent}
                    primaryTz={primaryTz}
                    secondaryTz={secondaryTz}
                  />
                ))}
              </div>
            </div>
          </div>

          {gridEvents.length === 0 && gridSlots.length === 0 ? (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-center text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {t('book.upcoming.emptyBody')}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                Click a solid meeting card to open details. Dashed blocks are proposed free slots.
              </span>

              <span>
                {secondaryTz
                  ? `Positioned by ${zoneShortLabel(primaryTz)}. Left gutter also shows ${zoneShortLabel(secondaryTz)}.`
                  : `Positioned by ${zoneShortLabel(primaryTz)}.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <CalendarEventDetailsDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        primaryTz={primaryTz}
        secondaryTz={secondaryTz}
      />
    </>
  );
}

// Gutter header. Dual-scale (org has a secondary zone): secondary on the left, primary
// on the right. Single-scale (secondary null): one primary column. Labels are derived
// from each IANA zone (e.g. "GMT+2"), never hardcoded.
function TimeScaleHeader({
  primaryTz,
  secondaryTz,
}: {
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const cell =
    'flex items-end justify-end px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

  if (!secondaryTz) {
    return (
      <div className="w-16 shrink-0 border-r">
        <div className={`h-full ${cell}`}>{zoneShortLabel(primaryTz)}</div>
      </div>
    );
  }

  return (
    <div className="grid w-32 shrink-0 grid-cols-2 border-r">
      <div className={`border-r ${cell}`}>{zoneShortLabel(secondaryTz)}</div>
      <div className={cell}>{zoneShortLabel(primaryTz)}</div>
    </div>
  );
}

function TimeScaleColumns({
  sampleDayKey,
  primaryTz,
  secondaryTz,
}: {
  sampleDayKey: string;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const labels = useMemo(() => {
    return HOURS.map((hour) => {
      const instant = zonedTimeToUtcDate(sampleDayKey, hour, 0, primaryTz);

      return {
        hour,
        secondary: secondaryTz ? formatClockInTimeZone(instant, secondaryTz) : null,
        primary: formatClockInTimeZone(instant, primaryTz),
      };
    });
  }, [sampleDayKey, primaryTz, secondaryTz]);

  const labelCell =
    'absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground';

  if (!secondaryTz) {
    return (
      <div className="w-16 shrink-0" style={{ height: HOURS.length * HOUR_HEIGHT }}>
        <div className="relative border-r">
          {labels.map((label) => (
            <div key={`primary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
              {label.primary}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-32 shrink-0 grid-cols-2" style={{ height: HOURS.length * HOUR_HEIGHT }}>
      <div className="relative border-r">
        {labels.map((label) => (
          <div key={`secondary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
            {label.secondary}
          </div>
        ))}
      </div>

      <div className="relative">
        {labels.map((label) => (
          <div key={`primary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
            {label.primary}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  dayKey,
  events,
  slots,
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
}: {
  dayKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarGridEvent) => void;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const laidOutEvents = useMemo(
    () => layoutDayEvents(events, dayKey, primaryTz),
    [events, dayKey, primaryTz],
  );

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden border-l border-b"
      style={{ height: HOURS.length * HOUR_HEIGHT }}
      aria-label={dayKey}
    >
      {HOURS.map((hour) => (
        <div key={hour} className="h-14 shrink-0 border-t" style={{ height: HOUR_HEIGHT }} />
      ))}

      {slots.map((slot) => (
        <CalendarSlotBlock
          key={`${slot.start.toISOString()}-${slot.end.toISOString()}`}
          dayKey={dayKey}
          start={slot.start}
          end={slot.end}
          primaryTz={primaryTz}
          secondaryTz={secondaryTz}
        />
      ))}

      {laidOutEvents.map((event) => (
        <CalendarEventBlock
          key={`${event.id}-${event.start}`}
          dayKey={dayKey}
          event={event}
          selected={selectedEventId === event.id}
          onSelect={() => onSelectEvent(event)}
          primaryTz={primaryTz}
          secondaryTz={secondaryTz}
        />
      ))}
    </div>
  );
}

function CalendarSlotBlock({
  dayKey,
  start,
  end,
  primaryTz,
  secondaryTz,
}: {
  dayKey: string;
  start: Date;
  end: Date;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const t = useTranslations('activate');

  const visual = getVisualRangeForDateKey(start, end, dayKey, primaryTz);

  const top = minuteToTop(visual.startMinute);
  const height = minuteRangeToHeight(visual.startMinute, visual.endMinute);

  const primaryLabel = zoneShortLabel(primaryTz);
  const primaryFrom = formatClockInTimeZone(start, primaryTz);
  const primaryTo = formatClockInTimeZone(end, primaryTz);
  const secondaryLabel = secondaryTz ? zoneShortLabel(secondaryTz) : null;
  const secondaryFrom = secondaryTz ? formatClockInTimeZone(start, secondaryTz) : null;
  const secondaryTo = secondaryTz ? formatClockInTimeZone(end, secondaryTz) : null;

  return (
    <button
      type="button"
      disabled
      className="absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-left text-[10px] text-emerald-700 opacity-90 transition-colors disabled:cursor-not-allowed dark:text-emerald-300"
      style={{
        top,
        height,
      }}
      title={
        secondaryTz
          ? `${primaryLabel} ${primaryFrom}–${primaryTo} · ${secondaryLabel} ${secondaryFrom}–${secondaryTo}`
          : `${primaryLabel} ${primaryFrom}–${primaryTo}`
      }
      aria-label={t('book.slots.rangeAria', {
        start: primaryFrom,
        end: primaryTo,
      })}
    >
      <span className="block font-semibold tabular-nums">
        {primaryLabel} {primaryFrom}–{primaryTo}
      </span>

      {secondaryTz ? (
        <span className="block truncate tabular-nums">
          {secondaryLabel} {secondaryFrom}–{secondaryTo}
        </span>
      ) : null}

      <span className="block truncate">{t('book.slots.book')}</span>
    </button>
  );
}

function CalendarEventBlock({
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

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'absolute z-20 overflow-hidden rounded-lg border border-border border-l-4 border-l-blue-500 bg-popover px-2 py-1.5 text-left text-popover-foreground shadow-lg transition',
        'hover:-translate-y-0.5 hover:bg-muted hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'ring-2 ring-blue-400' : '',
      ].join(' ')}
      style={style}
      title={
        secondaryTz
          ? `${title} · ${primaryLabel} ${primaryFrom}–${primaryTo} · ${secondaryLabel} ${secondaryFrom}–${secondaryTo}`
          : `${title} · ${primaryLabel} ${primaryFrom}–${primaryTo}`
      }
      aria-label={`${title}. ${primaryLabel} ${primaryFrom} to ${primaryTo}. Click for details.`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
        <Clock className="size-3 shrink-0" />
        <span className="truncate tabular-nums">
          {primaryLabel} {primaryFrom}–{primaryTo}
        </span>
      </div>

      <div className="truncate text-xs font-semibold leading-tight">{title}</div>

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
          Meet
        </div>
      ) : null}
    </button>
  );
}

function CalendarEventDetailsDialog({
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

function layoutDayEvents(
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

function getEventBlockStyle(
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

function getEventString(event: CalendarEventDto, key: string): string | null {
  const value = (event as unknown as Record<string, unknown>)[key];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateKey(dateKey: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = dateKey.split('-');

  const yearText = parts[0];
  const monthText = parts[1];
  const dayText = parts[2];

  if (!yearText || !monthText || !dayText) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return {
    year,
    month,
    day,
  };
}

function dateKeyToUtcDate(dateKey: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));

  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getZonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  const rawHour = Number(get('hour'));

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
  };
}

function zonedTimeToUtcDate(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  const wantedLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let utcMs = wantedLocalMs;

  for (let i = 0; i < 3; i += 1) {
    const actualParts = getZonedParts(new Date(utcMs), timeZone);

    const actualLocalMs = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      0,
      0,
    );

    utcMs += wantedLocalMs - actualLocalMs;
  }

  return new Date(utcMs);
}

function startOfWorkWeekKey(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  const currentKey = toDateKey(parts.year, parts.month, parts.day);
  const currentDate = dateKeyToUtcDate(currentKey);
  const day = currentDate.getUTCDay();

  const diffToMonday = day === 0 ? -6 : 1 - day;

  return addDaysToDateKey(currentKey, diffToMonday);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function overlapsDateKey(start: Date, end: Date, dateKey: string, timeZone: string): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  return end > dayStart && start < dayEnd;
}

function overlapsDateKeyRange(
  start: Date,
  end: Date,
  startKey: string,
  endKeyExclusive: string,
  timeZone: string,
): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const rangeStart = zonedTimeToUtcDate(startKey, 0, 0, timeZone);
  const rangeEnd = zonedTimeToUtcDate(endKeyExclusive, 0, 0, timeZone);

  return end > rangeStart && start < rangeEnd;
}

function getVisualRangeForDateKey(
  start: Date,
  end: Date,
  dateKey: string,
  timeZone: string,
): {
  startMinute: number;
  endMinute: number;
} {
  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  const visualStart = start < dayStart ? dayStart : start;
  const visualEnd = end > dayEnd ? dayEnd : end;

  if (visualEnd <= visualStart) {
    return {
      startMinute: 0,
      endMinute: 30,
    };
  }

  const startMinute =
    visualStart <= dayStart ? 0 : zonedMinutesSinceMidnight(visualStart, timeZone);

  const rawEndMinute =
    visualEnd >= dayEnd ? 24 * 60 : zonedMinutesSinceMidnight(visualEnd, timeZone);

  return {
    startMinute,
    endMinute: Math.min(24 * 60, Math.max(startMinute + 20, rawEndMinute)),
  };
}

function zonedMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);

  return parts.hour * 60 + parts.minute;
}

function minuteToTop(minute: number): number {
  const rawTop = (minute / 60) * HOUR_HEIGHT;
  const maxTop = HOURS.length * HOUR_HEIGHT - 30;

  return Math.max(0, Math.min(rawTop, maxTop));
}

function minuteRangeToHeight(startMinute: number, endMinute: number): number {
  const minutes = Math.max(20, endMinute - startMinute);

  return Math.max(32, (minutes / 60) * HOUR_HEIGHT);
}

function getIsoWeekNumber(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));

  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatClockInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// A short, human-readable label for an IANA zone (e.g. 'Europe/Berlin' → "GMT+2",
// 'Asia/Bangkok' → "GMT+7"), derived at the given instant so DST is reflected. Used
// for the time-scale gutters and event copy — never a hardcoded "CET/CEST"/"GMT+7".
function zoneShortLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');

  return part?.value ?? timeZone;
}
