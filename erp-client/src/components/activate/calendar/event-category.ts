import type { CalendarEventCategory } from '@evertrust/shared';

// Color code for calendar events, keyed by the derived `category` on each
// CalendarEventDto. `bar` is the left accent rail on a positioned event block,
// `dot` is the legend swatch fill, `tint` colors the title/label text, `ring` is
// the selected-card outline (matches the card's own color instead of a clashing
// brand-green ring), and `labelKey` is the i18n key (under `activate.calendar.legend.*`)
// for the human name shown in the legend — kept as a key, not a literal, because this
// is a non-component module (no hooks here). `dot`/`ring` are FULL static classes (not
// derived from `bar` at runtime) so Tailwind v4 actually generates these utilities.
// Stays within the DESIGN.md semantic palette (no new colors):
// client → blue · team → violet · personal → amber · reminder → slate · ooo → rose.
export const CATEGORY_STYLE: Record<
  CalendarEventCategory,
  { bar: string; dot: string; tint: string; ring: string; labelKey: string }
> = {
  client: { bar: 'border-l-blue-500', dot: 'bg-blue-500', tint: 'text-blue-300', ring: 'ring-blue-500', labelKey: 'calendar.legend.client' },
  team: { bar: 'border-l-violet-500', dot: 'bg-violet-500', tint: 'text-violet-300', ring: 'ring-violet-500', labelKey: 'calendar.legend.team' },
  personal: { bar: 'border-l-amber-500', dot: 'bg-amber-500', tint: 'text-amber-300', ring: 'ring-amber-500', labelKey: 'calendar.legend.personal' },
  reminder: { bar: 'border-l-slate-500', dot: 'bg-slate-500', tint: 'text-slate-300', ring: 'ring-slate-500', labelKey: 'calendar.legend.reminder' },
  ooo: { bar: 'border-l-rose-500', dot: 'bg-rose-500', tint: 'text-rose-300', ring: 'ring-rose-500', labelKey: 'calendar.legend.ooo' },
};
