'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

// A live ETA countdown for an in-flight Lead Satellite scrape. It is SEEDED FROM THE
// SERVER (startedAt + etaSeconds), so it stays correct after navigating away and
// back — the clock is derived from the aim's stored start time, never local state.
// When the estimate is exhausted but the scrape is still running, it shows a
// "finishing up" state instead of a negative number.
export function ScrapeCountdown({
  startedAt,
  etaSeconds,
}: {
  startedAt: string;
  etaSeconds: number;
}) {
  const t = useTranslations('reach');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startedAt).getTime();
  const eta = Number.isFinite(etaSeconds) && etaSeconds > 0 ? etaSeconds : 0;
  const elapsed = Math.max(0, Math.round((now - startMs) / 1000));
  const remaining = Math.max(0, eta - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const pct = eta > 0 ? Math.min(100, Math.round((elapsed / eta) * 100)) : 100;
  const overrun = remaining <= 0;

  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        {t('scraper.scrapingLabel')}
      </div>
      <div className="text-3xl font-bold tabular-nums text-foreground">
        {overrun ? t('scraper.finishing') : `${mm}:${ss}`}
      </div>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-muted">
        <div
          className={[
            'h-full rounded-full bg-primary transition-all duration-1000 ease-linear',
            overrun ? 'animate-pulse' : '',
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[12.5px] font-bold text-muted-foreground">
        {overrun ? t('scraper.finishingHint') : t('scraper.eta')}
      </div>
    </div>
  );
}
