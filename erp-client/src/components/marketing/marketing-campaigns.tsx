'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import type { CampaignDto, ProspectStatus } from '@evertrust/shared';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useProspectsBoard } from '@/hooks/use-prospects';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { CAMPAIGN_LIFECYCLE_BADGE } from '@/lib/arsenal-sequence';
import { AimLaunchDialog } from '@/components/growth/aim-launch-dialog';
import { DeleteCampaignButton } from '@/components/growth/delete-campaign-button';

// Reach → "Campaigns" tab (R.E.A.N. mockup, restyled to the Scraper-Campaigns layout).
// No KPI tiles — two stacked tables: a selectable "Scraper Campaigns" table
// (Campaign · Niche · Region · Companies · Status; COMPANIES is the live per-campaign
// prospect total) with the create (+ Campaign) + per-row manage / delete affordances,
// and a "Leads" table showing the SELECTED campaign's prospects.
export function MarketingCampaigns() {
  const t = useTranslations('growth.reach');
  const campaigns = useCampaigns();
  const list = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first campaign once the list loads (and clear the selection if
  // the chosen campaign disappears, e.g. after a delete).
  useEffect(() => {
    if (list.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((c) => c.id === selectedId)) {
      setSelectedId(list[0]!.id);
    }
  }, [list, selectedId]);

  const selected = list.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Scraper Campaigns ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span>{t('scraper.campaignsTitle')}</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t('scraper.active')}
              </span>
              <Can permission="campaigns:write">
                <AimLaunchDialog />
              </Can>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : campaigns.isError ? (
            <p className="text-sm text-destructive">
              {t('campaigns.loadError', { message: campaigns.error.message })}
            </p>
          ) : list.length === 0 ? (
            <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              {t('campaigns.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaigns.col.campaign')}</TableHead>
                    <TableHead>{t('campaigns.col.niche')}</TableHead>
                    <TableHead>{t('scraper.colRegion')}</TableHead>
                    <TableHead className="text-right">{t('scraper.colCompanies')}</TableHead>
                    <TableHead>{t('campaigns.col.lifecycle')}</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((c) => (
                    <ScraperCampaignRow
                      key={c.id}
                      campaign={c}
                      selected={c.id === selectedId}
                      onSelect={() => setSelectedId(c.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Leads (prospects of the selected campaign) ---- */}
      {selected ? <CampaignLeads campaign={selected} /> : null}
    </div>
  );
}

function ScraperCampaignRow({
  campaign: c,
  selected,
  onSelect,
}: {
  campaign: CampaignDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('growth.reach');
  const tM = useTranslations('marketing');
  const pill = CAMPAIGN_LIFECYCLE_BADGE[c.lifecycle];
  // COMPANIES = the campaign's live prospect total (limit 1 → we only read `total`).
  const board = useProspectsBoard({ campaignId: c.id, limit: 1 });
  const companies = board.data?.total ?? null;

  return (
    <TableRow
      onClick={onSelect}
      data-state={selected ? 'selected' : undefined}
      className={cn('cursor-pointer', selected && 'bg-muted/50')}
    >
      <TableCell className="relative font-medium">
        {selected ? (
          <span className="absolute inset-y-0 left-0 w-0.5 rounded-r bg-primary" />
        ) : null}
        <span className="truncate" title={c.project}>
          {c.name || c.project}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{c.nicheName ?? '—'}</TableCell>
      <TableCell className="text-muted-foreground">{c.region || '—'}</TableCell>
      <TableCell className="text-right tabular-nums">
        {board.isLoading ? (
          <Skeleton className="ml-auto h-4 w-6" />
        ) : companies === null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          companies.toLocaleString()
        )}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
            pill.className,
          )}
        >
          <span className="size-1.5 rounded-full bg-current opacity-70" />
          {tM(`lifecycle.${c.lifecycle}`)}
        </span>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5">
          <Button asChild variant="outline" size="sm">
            <Link href={`/marketing/${c.id}`}>
              {t('campaigns.manage')}
              <ArrowRight />
            </Link>
          </Button>
          <Can permission="campaigns:write">
            <DeleteCampaignButton campaign={c} />
          </Can>
        </div>
      </TableCell>
    </TableRow>
  );
}

// Prospect status → semantic pill tint (house palette; resolves in light + dark).
const LEAD_STATUS_CLASS: Record<ProspectStatus, string> = {
  NEW: 'border-border bg-muted text-muted-foreground',
  EMAILED: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  REPLIED: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  INTERESTED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  MEETING_SCHEDULED:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  NOT_INTERESTED: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  RE_ENGAGED: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  DO_NOT_CONTACT: 'border-border bg-muted text-muted-foreground/70',
};

function hostOf(url: string | null): string {
  if (!url) return '—';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function CampaignLeads({ campaign }: { campaign: CampaignDto }) {
  const t = useTranslations('growth.reach');
  const board = useProspectsBoard({ campaignId: campaign.id, limit: 50 });
  const items = board.data?.items ?? [];
  const total = board.data?.total ?? items.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            {t('scraper.leadsTitle')}
            <span className="text-muted-foreground">
              {' · '}
              {campaign.name || campaign.project}
              {campaign.region ? ` · ${campaign.region}` : ''}
            </span>
          </span>
          <span className="text-xs font-normal uppercase tracking-wide text-muted-foreground tabular-nums">
            {t('scraper.leadsCount', { count: total })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {board.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : board.isError ? (
          <p className="text-sm text-destructive">
            {t('campaigns.loadError', { message: board.error.message })}
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            {t('scraper.noLeads')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('scraper.leadCol.company')}</TableHead>
                  <TableHead>{t('scraper.leadCol.contact')}</TableHead>
                  <TableHead>{t('scraper.leadCol.location')}</TableHead>
                  <TableHead>{t('scraper.leadCol.source')}</TableHead>
                  <TableHead>{t('scraper.leadCol.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.companyName || p.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[p.city, p.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {hostOf(p.sourceUrl)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                          LEAD_STATUS_CLASS[p.status],
                        )}
                      >
                        {t(`scraper.leadStatus.${p.status}`)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
