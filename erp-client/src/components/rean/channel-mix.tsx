import { cn } from '@/lib/utils';

// Segment tones for the stacked bar + legend dots (mockup channel mix uses
// emerald / sky / violet).
const SEGMENT_TONES = {
  emerald: { bar: 'bg-emerald-400', dot: 'bg-emerald-400' },
  sky: { bar: 'bg-sky-400', dot: 'bg-sky-400' },
  violet: { bar: 'bg-violet-400', dot: 'bg-violet-400' },
  amber: { bar: 'bg-amber-400', dot: 'bg-amber-400' },
  rose: { bar: 'bg-rose-400', dot: 'bg-rose-400' },
} as const;

export type ChannelTone = keyof typeof SEGMENT_TONES;

export type ChannelSegment = {
  // Series label (e.g. "Email", "LinkedIn").
  label: string;
  // Share of the whole; values are normalised so they need not sum to 100.
  value: number;
  // Segment colour. Defaults are assigned by index when omitted.
  tone?: ChannelTone;
};

const DEFAULT_TONES: ChannelTone[] = ['emerald', 'sky', 'violet', 'amber', 'rose'];

// A horizontal stacked-bar channel breakdown with a legend (mockup "Channel
// mix", lines 508–519 — rendered here as a stacked bar + legend rather than a
// donut, using pure divs, no chart deps). Each legend row shows the label and
// the rounded percentage. Presentational.
export function ChannelMix({
  segments,
  className,
}: {
  segments: ChannelSegment[];
  className?: string;
}) {
  const total = Math.max(
    1,
    segments.reduce((sum, s) => sum + Math.max(0, s.value), 0),
  );
  const withPct = segments.map((s, i) => ({
    ...s,
    tone:
      s.tone ?? DEFAULT_TONES[i % DEFAULT_TONES.length] ?? ('emerald' as const),
    pct: (Math.max(0, s.value) / total) * 100,
  }));

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {withPct.map((s, i) => (
          <div
            key={i}
            className={cn('h-full', SEGMENT_TONES[s.tone].bar)}
            style={{ width: `${s.pct}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {withPct.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
          >
            <i
              className={cn(
                'inline-block size-2 rounded-full',
                SEGMENT_TONES[s.tone].dot,
              )}
            />
            {s.label} · {Math.round(s.pct)}%
          </span>
        ))}
      </div>
    </div>
  );
}
