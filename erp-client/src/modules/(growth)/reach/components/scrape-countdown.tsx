'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { ScrapePhase, ScrapeProgress } from '../types';

// Human labels for each scrape phase (the agent pushes the machine key).
const PHASE_LABEL: Record<ScrapePhase, string> = {
  search: 'Searching',
  scrape: 'Scraping',
  qualify: 'Qualifying',
  load: 'Saving leads',
};

// "2m 05s" style, concise. Empty once the run overruns the estimate.
function fmtRemaining(sec: number): string {
  if (sec <= 0) return '';
  if (sec < 60) return `~${sec}s left`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `~${m}m left` : `~${m}m ${String(s).padStart(2, '0')}s left`;
}

// A live ETA countdown for an in-flight Lead Satellite scrape. SEEDED FROM THE SERVER
// (startedAt + etaSeconds) so the clock survives navigation. When the agent pushes
// live per-phase progress, it shows the REAL process ("Searching · Bavaria (4/16)")
// and drives the bar off the phase fraction; otherwise it falls back to the
// time-based estimate. Overrun → a "finishing up" state instead of a negative number.
export function ScrapeCountdown({
  startedAt,
  etaSeconds,
  progress,
}: {
  startedAt: string;
  etaSeconds: number;
  progress?: ScrapeProgress | null;
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
  const overrun = remaining <= 0;

  // Bar: prefer the REAL phase fraction (e.g. region 4/16) when the agent reports a
  // countable phase; otherwise fall back to the time-elapsed estimate.
  const phaseFraction =
    progress && progress.total > 0 ? progress.current / progress.total : null;
  const timePct = eta > 0 ? Math.min(100, Math.round((elapsed / eta) * 100)) : 100;
  const pct =
    phaseFraction != null
      ? Math.min(100, Math.round(phaseFraction * 100))
      : timePct;

  // The header line: the live phase ("Searching"), or the generic scraping label.
  const header = progress ? PHASE_LABEL[progress.phase] : t('scraper.scrapingLabel');

  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        {header}
      </div>

      <div className="text-3xl font-bold tabular-nums text-foreground">
        {overrun ? t('scraper.finishing') : `${mm}:${ss}`}
      </div>

      {/* The REAL process line, pushed by the agent (e.g. "Bavaria (4/16)"). */}
      {progress?.label ? (
        <div className="text-[13px] font-semibold text-foreground/80">
          {progress.label}
        </div>
      ) : null}

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
        {overrun
          ? t('scraper.finishingHint')
          : fmtRemaining(remaining) || t('scraper.eta')}
      </div>
    </div>
  );
}
