import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// The mockup's accent set (style block lines 8–10 + .stat .bar). Each maps to a
// `bg-*` class for the 3px top bar. Default is emerald.
const ACCENT_BARS = {
  emerald: 'bg-emerald-400',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
} as const;

export type StatAccent = keyof typeof ACCENT_BARS;

// A KPI tile matching the prototype's `.stat` (lines 79–84): a coloured 3px top
// bar, an uppercase label, a large tabular value, and an optional up/down delta
// rendered in emerald (up) / rose (down) with a directional arrow.
//
// This is the R.E.A.N. superset of common/stat-tile.tsx: it keeps the same
// label/value/accent contract but adds the delta affordance the dashboard +
// analytics pages need. Presentational only — pass already-formatted strings.
//  - accent: tone for the top bar (emerald | sky | violet | amber | rose). Omit for none.
//  - delta:  formatted change string (e.g. "+12%"); `direction` colours it.
export function StatTile({
  label,
  value,
  delta,
  direction = 'up',
  hint,
  accent,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  direction?: 'up' | 'down';
  hint?: ReactNode;
  accent?: StatAccent;
  icon?: ReactNode;
  className?: string;
}) {
  const up = direction === 'up';
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-card p-4 shadow-sm',
        className,
      )}
    >
      {accent ? (
        <span
          className={cn('absolute inset-x-0 top-0 h-[3px]', ACCENT_BARS[accent])}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className="shrink-0 text-muted-foreground">{icon}</span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      {delta != null ? (
        <span
          className={cn(
            'mt-1.5 inline-flex items-center gap-1 text-xs font-medium',
            up ? 'text-emerald-500' : 'text-rose-500',
          )}
        >
          {up ? (
            <ArrowUpRight className="size-3.5" />
          ) : (
            <ArrowDownRight className="size-3.5" />
          )}
          {delta}
        </span>
      ) : null}
      {hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
