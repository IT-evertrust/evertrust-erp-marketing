import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A single KPI / summary tile. Drop a row of these (in a
// `grid grid-cols-2 gap-3 lg:grid-cols-4`) above a page's main content to turn a
// bare list into a dashboard-grade surface.
//  - accent: a bg-* class for the thin top bar (e.g. 'bg-emerald-400'); omit for none
//  - icon:   a small lucide icon shown top-right
//  - hint:   sub-label under the value (e.g. "3 at risk")
export function StatTile({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card p-4">
      {accent ? (
        <span className={cn('absolute inset-x-0 top-0 h-0.5', accent)} />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className="shrink-0 text-muted-foreground">{icon}</span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none tabular-nums">
        {value}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
