'use client';

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CalendarClock, CalendarX, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  getIsoWeekNumber,
  overlapsDateKeyRange,
  isValidDate,
  startOfWorkWeekKey,
  zoneShortLabel,
} from '@/components/activate/calendar/time-grid';
import { WeekView } from '@/components/activate/calendar/week-view';
import { CalendarEventDetailsDialog } from '@/components/activate/calendar/event-details-dialog';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
  FreeSlotsQuery,
  UpcomingQuery,
} from '@/components/activate/calendar/types';

const WORK_WEEK_DAYS = 7;

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

export function Calendar({
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
          <WeekView
            days={days}
            weekStartKey={weekStartKey}
            events={gridEvents}
            slots={gridSlots}
            selectedEventId={selectedEvent?.id ?? null}
            onSelectEvent={setSelectedEvent}
            primaryTz={primaryTz}
            secondaryTz={secondaryTz}
          />

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
