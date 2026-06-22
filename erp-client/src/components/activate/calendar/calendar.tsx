'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CalendarClock, CalendarX } from 'lucide-react';
import { useCalendarFreeSlots, useCalendarUpcoming } from '@/hooks/use-meetings';
import { useCampaigns } from '@/hooks/use-campaigns';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_TIME_ZONE,
  addDaysToDateKey,
  dateKeyToUtcDate,
  overlapsDateKeyRange,
  isValidDate,
  parseDateKey,
  startOfWorkWeekKey,
  toDateKey,
  zoneShortLabel,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';
import { WeekView } from '@/components/activate/calendar/week-view';
import { DayView } from '@/components/activate/calendar/day-view';
import { MonthView } from '@/components/activate/calendar/month-view';
import { ControlBar } from '@/components/activate/calendar/control-bar';
import { CalendarLegend } from '@/components/activate/calendar/calendar-legend';
import { CalendarEventDetailsDialog } from '@/components/activate/calendar/event-details-dialog';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
  CalendarView,
} from '@/components/activate/calendar/types';

const WEEK_DAYS = 7;
const MONTH_GRID_DAYS = 42;
const FREE_SLOT_DURATION_MINUTES = 30;

// First day of the month for a given anchor key.
function startOfMonthKey(dateKey: string): string {
  const { year, month } = parseDateKey(dateKey);
  return toDateKey(year, month, 1);
}

// The Monday-aligned start of the visible month grid (the work week containing
// the 1st), in the org's render zone.
function monthGridStartKey(dateKey: string, timeZone: string): string {
  return startOfWorkWeekKey(dateKeyToUtcDate(startOfMonthKey(dateKey)), timeZone);
}

// Step the anchor by the active view's unit.
function stepAnchor(dateKey: string, view: CalendarView, direction: 1 | -1): string {
  if (view === 'day') {
    return addDaysToDateKey(dateKey, direction);
  }

  if (view === 'week') {
    return addDaysToDateKey(dateKey, direction * WEEK_DAYS);
  }

  // month: jump to the same day-of-month one month away (clamped by Date math).
  const { year, month, day } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1 + direction, day, 12, 0, 0, 0));
  return toDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

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

export function Calendar() {
  const t = useTranslations('activate');
  const format = useFormatter();

  const [view, setView] = useState<CalendarView>('week');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);
  // Bookable weekdays for the free-slot finder (0=Sun..6=Sat), default Mon–Fri so
  // nothing changes unless the user toggles. Passed to the free-slots query as CSV.
  const [businessDays, setBusinessDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [anchorKey, setAnchorKey] = useState(() =>
    startOfWorkWeekKey(new Date(), DEFAULT_TIME_ZONE),
  );

  const [selectedEvent, setSelectedEvent] = useState<CalendarGridEvent | null>(null);

  const campaignsQuery = useCampaigns();
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  // The visible grid's first day, derived from view + anchor (week starts Monday;
  // month grid aligns to the Monday of the week containing the 1st).
  const gridStartKey = useMemo(() => {
    if (view === 'week') {
      return startOfWorkWeekKey(dateKeyToUtcDate(anchorKey), DEFAULT_TIME_ZONE);
    }

    if (view === 'month') {
      return monthGridStartKey(anchorKey, DEFAULT_TIME_ZONE);
    }

    return anchorKey;
  }, [view, anchorKey]);

  const gridDayCount = view === 'month' ? MONTH_GRID_DAYS : view === 'week' ? WEEK_DAYS : 1;

  // Fetch window: the visible grid buffered ±1 day so no event/slot is clipped at
  // the edge when the render zone differs from the fetch zone. The fetch window is
  // zone-agnostic; DEFAULT_TIME_ZONE here only tags the request.
  const calendarRange = useMemo(() => {
    const timeMin = zonedTimeToUtcDate(
      addDaysToDateKey(gridStartKey, -1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    const timeMax = zonedTimeToUtcDate(
      addDaysToDateKey(gridStartKey, gridDayCount + 1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: DEFAULT_TIME_ZONE,
    };
  }, [gridStartKey, gridDayCount]);

  const upcoming = useCalendarUpcoming(calendarRange);
  const freeSlots = useCalendarFreeSlots({
    ...calendarRange,
    durationMinutes: FREE_SLOT_DURATION_MINUTES,
    businessDays,
  });

  // Only the meeting/slot CELLS show a loading state — the chrome (ControlBar,
  // Legend, grid frame, headers) renders immediately and stays mounted.
  const loading = upcoming.isLoading || freeSlots.isLoading;

  // The org's RESOLVED calendar zones (org_config ?? product default), carried on
  // the payload. `primaryTz` always present; `secondaryTz` null = single scale.
  const primaryTz = upcoming.data?.timeZone ?? freeSlots.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const secondaryTz =
    upcoming.data?.secondaryTimeZone ?? freeSlots.data?.secondaryTimeZone ?? null;

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);
  const reason = upcoming.data?.reason ?? freeSlots.data?.reason ?? null;

  const days = useMemo(
    () => Array.from({ length: gridDayCount }, (_, i) => addDaysToDateKey(gridStartKey, i)),
    [gridStartKey, gridDayCount],
  );

  const gridEndKey = useMemo(
    () => addDaysToDateKey(gridStartKey, gridDayCount),
    [gridStartKey, gridDayCount],
  );

  const gridEvents = useMemo<CalendarGridEvent[]>(() => {
    return (upcoming.data?.events ?? [])
      .map((event) => ({
        ...event,
        startDate: new Date(event.start),
        endDate: new Date(event.end),
      }))
      .filter((event) => {
        if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) {
          return false;
        }

        if (
          !overlapsDateKeyRange(
            event.startDate,
            event.endDate,
            gridStartKey,
            gridEndKey,
            primaryTz,
          )
        ) {
          return false;
        }

        // Campaign filter (client-side): when a campaign is selected, keep only
        // events tagged with it. "All" (null) keeps everything.
        return campaignId === null || event.campaignIds.includes(campaignId);
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [upcoming.data?.events, gridStartKey, gridEndKey, primaryTz, campaignId]);

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

        return overlapsDateKeyRange(slot.start, slot.end, gridStartKey, gridEndKey, primaryTz);
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [freeSlots.data?.slots, gridStartKey, gridEndKey, primaryTz]);

  const rangeLabel = useMemo(() => {
    if (view === 'month') {
      return format.dateTime(dateKeyToUtcDate(startOfMonthKey(anchorKey)), {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      });
    }

    if (view === 'day') {
      return format.dateTime(dateKeyToUtcDate(anchorKey), {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    }

    const start = format.dateTime(dateKeyToUtcDate(gridStartKey), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    });

    const end = format.dateTime(dateKeyToUtcDate(addDaysToDateKey(gridStartKey, WEEK_DAYS - 1)), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    });

    return `${start} – ${end}`;
  }, [view, anchorKey, gridStartKey, format]);

  if (upcoming.isError || freeSlots.isError) {
    return (
      <Card>
        <CardContent className="py-10">
          <p className="text-center text-sm text-muted-foreground">{t('book.upcoming.error')}</p>
        </CardContent>
      </Card>
    );
  }

  // Only treat the org as unconfigured once a query has actually resolved — during
  // the initial fetch both payloads are undefined, so don't flash the connect hint;
  // the chrome + skeleton cells render instead.
  if (!loading && !configured) {
    return <ConnectHint reason={reason} />;
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b">
          <ControlBar
            view={view}
            onViewChange={setView}
            campaignId={campaignId}
            onCampaignChange={setCampaignId}
            campaigns={campaigns}
            rangeLabel={rangeLabel}
            onPrev={() => setAnchorKey((key) => stepAnchor(key, view, -1))}
            onNext={() => setAnchorKey((key) => stepAnchor(key, view, 1))}
            businessDays={businessDays}
            onBusinessDaysChange={setBusinessDays}
            freeOnly={freeOnly}
            onToggleFreeOnly={() => setFreeOnly((value) => !value)}
          />

          <CalendarLegend />

          {freeOnly ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {t('calendar.freeSlot.banner')}
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {view === 'week' ? (
            <WeekView
              days={days}
              weekStartKey={gridStartKey}
              events={gridEvents}
              slots={gridSlots}
              selectedEventId={selectedEvent?.id ?? null}
              onSelectEvent={setSelectedEvent}
              primaryTz={primaryTz}
              secondaryTz={secondaryTz}
              freeOnly={freeOnly}
              loading={loading}
            />
          ) : view === 'day' ? (
            <DayView
              dayKey={anchorKey}
              events={gridEvents}
              slots={gridSlots}
              selectedEventId={selectedEvent?.id ?? null}
              onSelectEvent={setSelectedEvent}
              primaryTz={primaryTz}
              secondaryTz={secondaryTz}
              freeOnly={freeOnly}
              loading={loading}
            />
          ) : (
            <MonthView
              anchorKey={anchorKey}
              events={gridEvents}
              slots={gridSlots}
              primaryTz={primaryTz}
              freeOnly={freeOnly}
              loading={loading}
              onDayClick={(dateKey) => {
                setAnchorKey(dateKey);
                setView('day');
              }}
            />
          )}

          {loading ? null : gridEvents.length === 0 && gridSlots.length === 0 ? (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-center text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {t('book.upcoming.emptyBody')}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>{t('calendar.footer.hint')}</span>

              <span>
                {secondaryTz
                  ? t('calendar.footer.positionedDual', {
                      primary: zoneShortLabel(primaryTz),
                      secondary: zoneShortLabel(secondaryTz),
                    })
                  : t('calendar.footer.positionedSingle', {
                      primary: zoneShortLabel(primaryTz),
                    })}
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
