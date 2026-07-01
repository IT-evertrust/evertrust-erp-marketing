'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

// Three dots that bounce in sequence — the "…" animation.
function AnimatedDots() {
  return (
    <span className="ml-1 inline-flex items-end gap-0.5" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="inline-block size-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

type GeneratingStageProps = {
  // Already-translated stage label, e.g. "Generating prompt".
  label: string;
  // Rough estimate for this stage; drives the "est ~Ns" countdown.
  estSeconds: number;
};

// One live progress line for a generation stage: spinner + label + animated dots +
// a countdown from the estimate (then "almost done" once it overruns).
export function GeneratingStage({ label, estSeconds }: GeneratingStageProps) {
  const t = useTranslations('reach');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [label]);

  const remaining = Math.max(0, estSeconds - elapsed);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
      <Loader2 className="size-4 shrink-0 animate-spin text-foreground" />
      <span className="flex items-center text-[13px] font-semibold text-foreground">
        {label}
        <AnimatedDots />
      </span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {remaining > 0
          ? t('modal.stage.est', { seconds: remaining })
          : t('modal.stage.almostDone')}
      </span>
    </div>
  );
}
