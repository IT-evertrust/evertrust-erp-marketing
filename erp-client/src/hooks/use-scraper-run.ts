'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProspectDto } from '@evertrust/shared';
import { useRunArsenalStage } from './use-arsenal';
import { useProspectsBoard } from './use-prospects';

export type ScraperPhase = 'idle' | 'running' | 'success' | 'failed';

// Drives the live Lead Scraper run for one campaign. The ERP's POST /arsenal/run
// blocks until the LEAD_SATELLITE agent finishes (it awaits the agent call), so the
// mutation's pending→settled lifecycle IS the scrape lifecycle: while pending we show
// progress; on settle we refresh the campaign's prospects so the freshly scraped leads
// surface. We never invent a percentage — the agent reports once, at the end — so the
// UI shows honest elapsed time + an indeterminate, stage-labelled animation.
export function useScraperRun(campaignId: string | undefined) {
  const run = useRunArsenalStage();
  const leads = useProspectsBoard(campaignId ? { campaignId, limit: 8 } : {});

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Lead count at dispatch time, so we can report how many NEW leads the run added.
  const baseTotal = useRef<number | null>(null);

  // Derive the phase from the (blocking) mutation. A DISPATCHED result means the agent
  // accepted + ran; any other recorded status (FAILED/ERROR) is a real failure.
  const phase: ScraperPhase = run.isPending
    ? 'running'
    : run.isError
      ? 'failed'
      : run.isSuccess
        ? run.data?.status === 'DISPATCHED'
          ? 'success'
          : 'failed'
        : 'idle';

  // Live elapsed ticker while the run is in flight.
  useEffect(() => {
    if (phase !== 'running' || startedAt == null) return;
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      500,
    );
    return () => clearInterval(id);
  }, [phase, startedAt]);

  // On settle (success or failure), pull the campaign's prospects so any leads the run
  // attached show immediately — even a "failed" (e.g. agent-timeout) run may have saved
  // some before the ERP→agent call aborted.
  useEffect(() => {
    if (run.isSuccess || run.isError) void leads.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.isSuccess, run.isError]);

  const start = useCallback(() => {
    if (!campaignId || run.isPending) return;
    baseTotal.current = leads.data?.total ?? 0;
    setStartedAt(Date.now());
    setElapsed(0);
    run.mutate({ stage: 'LEAD_SATELLITE', campaignId });
  }, [campaignId, run, leads.data?.total]);

  const failureDetail = run.isError
    ? (run.error?.message ?? null)
    : run.data && run.data.status !== 'DISPATCHED'
      ? run.data.detail
      : null;

  const leadsTotal = leads.data?.total ?? 0;
  const newLeads =
    phase === 'success' && baseTotal.current != null
      ? Math.max(0, leadsTotal - baseTotal.current)
      : null;

  return {
    phase,
    elapsed,
    start,
    canRun: !!campaignId && !run.isPending,
    leads: (leads.data?.items ?? []) as ProspectDto[],
    leadsTotal,
    newLeads,
    failureDetail,
  };
}
