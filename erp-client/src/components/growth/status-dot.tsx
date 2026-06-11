import { cn } from '@/lib/utils';
import { OUTCOME_DOT, type RunOutcome } from '@/lib/arsenal-sequence';

// The status dot for a sequence node. When `running`, it shows an animated emerald
// ping (a stage that was just dispatched and is presumably working in n8n);
// otherwise a solid dot coloured by the last-run outcome (emerald / rose / idle).
export function StatusDot({
  outcome,
  running,
  className,
}: {
  outcome: RunOutcome;
  running?: boolean;
  className?: string;
}) {
  if (running) {
    return (
      <span className={cn('relative flex size-2.5', className)} aria-label="running">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  return (
    <span className={cn('size-2.5 rounded-full', OUTCOME_DOT[outcome], className)} />
  );
}
