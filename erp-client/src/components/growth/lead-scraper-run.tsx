'use client';

import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RadarIcon,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScraperRun, type ScraperPhase } from '@/hooks/use-scraper-run';

// The live Lead Scraper run surface. Replaces the bare dispatch button: it fires the
// LEAD_SATELLITE agent for the selected campaign, shows honest in-progress feedback
// while the (blocking) run is in flight, then surfaces the freshly scraped leads.
export function LeadScraperRun({ campaignId }: { campaignId: string | undefined }) {
  const t = useTranslations('growth.reach.scraper');
  const r = useScraperRun(campaignId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="default"
          disabled={!r.canRun}
          onClick={r.start}
        >
          {r.phase === 'running' ? (
            <Loader2 className="animate-spin" />
          ) : r.phase === 'success' ? (
            <RotateCw />
          ) : (
            <Play />
          )}
          {r.phase === 'running'
            ? t('progress.running')
            : r.phase === 'success'
              ? t('progress.runAgain')
              : t('run')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('targetsHint')}</p>
      </div>

      {r.phase === 'running' ? <RunningCard elapsed={r.elapsed} /> : null}

      {r.phase === 'success' ? (
        <ResultBanner
          tone="ok"
          icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          title={
            r.newLeads != null && r.newLeads > 0
              ? t('progress.foundNew', { count: r.newLeads })
              : t('progress.done')
          }
          detail={t('progress.totalLeads', { count: r.leadsTotal })}
        />
      ) : null}

      {r.phase === 'failed' ? (
        <ResultBanner
          tone="error"
          icon={<AlertTriangle className="size-4 text-red-500" />}
          title={t('progress.failed')}
          detail={r.failureDetail ?? t('progress.failedUnknown')}
        />
      ) : null}

      {/* The result surface: leads scraped for this campaign, refreshed on settle. */}
      {r.leads.length > 0 ? (
        <LeadsPreview leads={r.leads} total={r.leadsTotal} phase={r.phase} />
      ) : null}
    </div>
  );
}

// The three illustrative phases the agent moves through. The agent does not stream
// progress, so the active step advances on an elapsed-time heuristic — clearly
// "working", never a fabricated percentage.
function RunningCard({ elapsed }: { elapsed: number }) {
  const t = useTranslations('growth.reach.scraper');
  const steps = [
    { key: 'discover', until: 12 },
    { key: 'enrich', until: 45 },
    { key: 'save', until: Infinity },
  ] as const;
  const activeIdx = steps.findIndex((s) => elapsed < s.until);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <RadarIcon className="size-4 animate-pulse text-emerald-500" />
          {t('progress.scraping')}
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {/* Indeterminate sweep bar. */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-emerald-500"
          style={{ animation: 'scraper-sweep 1.4s ease-in-out infinite' }}
        />
      </div>

      <ol className="mt-3 flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={`flex items-center gap-2 text-xs ${
              i < activeIdx
                ? 'text-muted-foreground'
                : i === activeIdx
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground/50'
            }`}
          >
            {i < activeIdx ? (
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            ) : i === activeIdx ? (
              <Loader2 className="size-3.5 animate-spin text-emerald-500" />
            ) : (
              <span className="size-3.5 rounded-full border" />
            )}
            {t(`progress.steps.${s.key}`)}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs text-muted-foreground">{t('progress.hint')}</p>
    </div>
  );
}

function ResultBanner({
  tone,
  icon,
  title,
  detail,
}: {
  tone: 'ok' | 'error';
  icon: React.ReactNode;
  title: string;
  detail: string | null;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
        tone === 'ok'
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-red-500/30 bg-red-500/5'
      }`}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="flex flex-col">
        <span className="font-medium">{title}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
    </div>
  );
}

function LeadsPreview({
  leads,
  total,
  phase,
}: {
  leads: import('@evertrust/shared').ProspectDto[];
  total: number;
  phase: ScraperPhase;
}) {
  const t = useTranslations('growth.reach.scraper');
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-medium">{t('progress.leadsTitle')}</span>
        <span className="text-xs text-muted-foreground">
          {t('progress.leadsCount', { shown: leads.length, total })}
        </span>
      </div>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {leads.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="px-4 py-2.5 font-medium">
                {p.companyName ?? p.email}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{p.email}</td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {[p.city, p.country].filter(Boolean).join(', ') || '—'}
              </td>
              <td className="px-4 py-2.5 text-right">
                {p.emailVerified ? (
                  <span className="text-xs font-medium text-emerald-500">
                    {t('progress.verified')}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t('progress.unverified')}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {phase === 'success' && total > leads.length ? (
        <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
          {t('progress.moreInCampaigns')}
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
