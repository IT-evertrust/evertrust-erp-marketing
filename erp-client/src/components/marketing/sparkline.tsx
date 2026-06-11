import { cn } from '@/lib/utils';

// A tiny CSS bar sparkline (no chart dependency). `values` are per-bucket counts
// (oldest → newest); bars are normalised to the series max. A flat row of minimal
// bars when everything is zero. Purely decorative → aria-hidden.
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div
      className={cn('flex h-8 items-end gap-0.5', className)}
      aria-hidden="true"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px] bg-sky-500/50"
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}
