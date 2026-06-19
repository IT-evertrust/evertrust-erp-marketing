'use client';

import { useTranslations } from 'next-intl';
import { CALENDAR_EVENT_CATEGORIES } from '@evertrust/shared';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';

// Color-code legend: one swatch per event category plus the emerald free-slot
// marker. Sits on the row directly below the control bar.
export function CalendarLegend() {
  const t = useTranslations('activate');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {CALENDAR_EVENT_CATEGORIES.map((category) => {
        const style = CATEGORY_STYLE[category];

        return (
          <span key={category} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-sm ${style.dot}`} />
            {t(style.labelKey)}
          </span>
        );
      })}

      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-sm border border-dashed border-emerald-500 bg-emerald-500/10" />
        {t('calendar.legend.freeSlot')}
      </span>
    </div>
  );
}
