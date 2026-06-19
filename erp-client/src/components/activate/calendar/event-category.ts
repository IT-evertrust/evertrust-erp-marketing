import type { CalendarEventCategory } from '@evertrust/shared';

// Color code for calendar events, keyed by the derived `category` on each
// CalendarEventDto. `bar` is the left accent rail on a positioned event block,
// `tint` colors the title/label text, and `label` is the human name shown in the
// legend. Stays within the DESIGN.md semantic palette (no new colors):
// client → blue · team → violet · personal → amber · reminder → slate · ooo → rose.
export const CATEGORY_STYLE: Record<
  CalendarEventCategory,
  { bar: string; tint: string; label: string }
> = {
  client: { bar: 'border-l-blue-500', tint: 'text-blue-300', label: 'Client meeting' },
  team: { bar: 'border-l-violet-500', tint: 'text-violet-300', label: 'Internal / team' },
  personal: { bar: 'border-l-amber-500', tint: 'text-amber-300', label: 'Personal' },
  reminder: { bar: 'border-l-slate-500', tint: 'text-slate-300', label: 'Reminder' },
  ooo: { bar: 'border-l-rose-500', tint: 'text-rose-300', label: 'Out of office' },
};
