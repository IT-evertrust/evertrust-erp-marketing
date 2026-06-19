'use client';

import { CALENDAR_EVENT_CATEGORIES } from '@evertrust/shared';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';

// Maps a `border-l-{color}-500` bar class to the matching dot fill so the legend
// swatch reads as the same color as the event block's accent rail.
function dotClass(barClass: string): string {
  return barClass.replace('border-l-', 'bg-');
}

// Color-code legend: one swatch per event category plus the emerald free-slot
// marker. Sits on the row directly below the control bar.
export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {CALENDAR_EVENT_CATEGORIES.map((category) => {
        const style = CATEGORY_STYLE[category];

        return (
          <span key={category} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-sm ${dotClass(style.bar)}`} />
            {style.label}
          </span>
        );
      })}

      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-sm border border-dashed border-emerald-500 bg-emerald-500/10" />
        Free slot
      </span>
    </div>
  );
}
