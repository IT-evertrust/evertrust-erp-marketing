import { cn } from '@/lib/utils';

// Bar fill tones (mockup uses sky / violet / accent across the week groups).
const BAR_TONES = {
  emerald: 'fill-emerald-400',
  sky: 'fill-sky-400',
  violet: 'fill-violet-400',
  amber: 'fill-amber-400',
  rose: 'fill-rose-400',
} as const;

export type MiniBarTone = keyof typeof BAR_TONES;

export type MiniBar = {
  // Optional x-axis label under the bar.
  label?: string;
  // Raw value; bar heights are scaled to the max across all bars.
  value: number;
  // Bar colour. Defaults to emerald.
  tone?: MiniBarTone;
};

// A compact labelled vertical bar chart (mockup "Replies by week", lines
// 497–506) rendered as pure SVG — no chart deps. Bars auto-scale to the largest
// value. Presentational; pass already-aggregated data.
export function MiniBarChart({
  bars,
  height = 200,
  className,
}: {
  bars: MiniBar[];
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const count = Math.max(1, bars.length);
  const width = 560;
  const padX = 24;
  const baseline = height - 30;
  const slot = (width - padX * 2) / count;
  const barW = Math.min(48, slot * 0.62);
  const hasLabels = bars.some((b) => b.label);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-auto w-full', className)}
      role="img"
    >
      <line
        x1={padX}
        y1={baseline}
        x2={width - padX}
        y2={baseline}
        className="stroke-border"
      />
      {bars.map((b, i) => {
        const h = (b.value / max) * (baseline - 12);
        const x = padX + slot * i + (slot - barW) / 2;
        const y = baseline - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, h)}
              rx={4}
              className={BAR_TONES[b.tone ?? 'emerald']}
            />
            {hasLabels && b.label ? (
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {b.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
