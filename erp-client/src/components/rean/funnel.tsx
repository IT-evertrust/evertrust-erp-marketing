import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Per-bar fill colour. Defaults follow the mockup's R.E.A.N. ordering
// (Reach=sky, Engage=violet, Activate=amber, Nurture=emerald) but any row can
// override via `tone`.
const FILL_TONES = {
  emerald: 'bg-emerald-400',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
} as const;

export type FunnelTone = keyof typeof FILL_TONES;

export type FunnelStage = {
  // Stage label shown in the left gutter (e.g. "Reach", "Engage").
  label: ReactNode;
  // Bar width as a percentage 0–100 (already computed by the caller).
  percent: number;
  // Text drawn inside the bar (e.g. "100%", "26%"). Defaults to `${percent}%`.
  fill?: ReactNode;
  // Absolute count drawn flush-right (e.g. "12,480").
  value: ReactNode;
  // Bar colour. Defaults to the R.E.A.N. order by index.
  tone?: FunnelTone;
};

const DEFAULT_TONES: FunnelTone[] = ['sky', 'violet', 'amber', 'emerald'];

// The R.E.A.N. conversion funnel (mockup `.funnel` / `.frow`, lines 89–94 +
// 302–306): a stack of labelled horizontal bars, each with a percentage fill and
// a right-aligned absolute value. Presentational — the caller supplies stages
// with pre-computed percents.
export function Funnel({
  stages,
  className,
}: {
  stages: FunnelStage[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {stages.map((s, i) => {
        const tone =
          s.tone ?? DEFAULT_TONES[i % DEFAULT_TONES.length] ?? 'emerald';
        const pct = Math.max(0, Math.min(100, s.percent));
        return (
          <div
            key={i}
            className="grid items-center gap-3"
            style={{ gridTemplateColumns: '90px 1fr 56px' }}
          >
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="h-[26px] overflow-hidden rounded-md bg-muted">
              <div
                className={cn(
                  'flex h-full items-center rounded-md pl-2.5 text-[11.5px] font-bold text-emerald-950',
                  FILL_TONES[tone],
                )}
                style={{ width: `${pct}%` }}
              >
                {s.fill ?? `${pct}%`}
              </div>
            </div>
            <div className="text-right text-xs font-semibold tabular-nums">
              {s.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
