'use client';

import { useTranslations } from 'next-intl';
import {
  formatClockInTimeZone,
  getVisualRangeForDateKey,
  minuteRangeToHeight,
  minuteToTop,
  zoneShortLabel,
} from '@/components/activate/calendar/time-grid';

export function CalendarSlotBlock({
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
