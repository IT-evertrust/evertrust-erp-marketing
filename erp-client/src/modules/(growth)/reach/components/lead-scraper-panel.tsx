'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign, Lead } from '../types';
import { BatchDialog } from './batch-dialog';
import { CampaignTable } from './campaign-table';
import { ScrapeCountdown } from './scrape-countdown';
import { Spinner } from './spinner';

type LeadScraperPanelProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  onCreateCampaign: () => void;
  selectedCampaignName?: string;
  leads: Lead[];
  loadingCampaigns?: boolean;
  loadingLeads?: boolean;
  // The selected campaign's in-flight scrape (server-seeded), or null when idle.
  scrape?: { startedAt: string; etaSeconds: number } | null;
  // The reason the selected campaign's last scrape failed, or null.
  scrapeError?: string | null;
  // The selected campaign's generated base prompt (null until generated) — gates the
  // "Run scrape" batch action.
  selectedScrapePrompt?: string | null;
  // Refresh the leads table + campaign list after a batch's leads are saved.
  onLeadsSaved?: () => void;
  // Scraping mode: 'manual' = copy/paste batch prompts, 'auto' = Lead Satellite pipeline.
  scrapeMode?: 'manual' | 'auto';
  onSetScrapeMode?: (mode: 'manual' | 'auto') => void;
  // Automatic mode: kick off the Lead Satellite scrape for the selected campaign.
  onRunLeadSatellite?: (aimId: string) => void;
  // Permanently delete a campaign (after the confirm popup).
  onDeleteCampaign?: (aimId: string) => void;
};

// Client-side pagination: the leads list is already fully loaded, so we page through
// it in memory — ten rows per page.
const PAGE_SIZE = 10;

export function LeadScraperPanel({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  onCreateCampaign,
  selectedCampaignName,
  leads,
  loadingCampaigns = false,
  loadingLeads = false,
  scrape = null,
  scrapeError = null,
  selectedScrapePrompt = null,
  onLeadsSaved,
  scrapeMode = 'manual',
  onSetScrapeMode,
  onRunLeadSatellite,
  onDeleteCampaign,
}: LeadScraperPanelProps) {
  const t = useTranslations('reach');

  const [batchOpen, setBatchOpen] = useState(false);
  const [page, setPage] = useState(0);
  // Active state/Bundesland filter tab ('all' shows every state).
  const [stateFilter, setStateFilter] = useState('all');

  // Distinct states present in the current lead set — real states sorted A→Z, the
  // "no state" bucket ('—') pushed to the end.
  const statesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) set.add(l.state || '—');
    return Array.from(set).sort((a, b) =>
      a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b),
    );
  }, [leads]);

  const filteredLeads = useMemo(
    () =>
      stateFilter === 'all'
        ? leads
        : leads.filter((l) => (l.state || '—') === stateFilter),
    [leads, stateFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  // Reset paging + clear the state filter when the operator switches campaigns.
  useEffect(() => {
    setPage(0);
    setStateFilter('all');
  }, [selectedCampaignId]);
  // Jump to the first page whenever the active state tab changes.
  useEffect(() => {
    setPage(0);
  }, [stateFilter]);
  // Clamp the page if the visible set shrinks (rescan or filter change).
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);
  const pageLeads = filteredLeads.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Scraping mode: manual (copy/paste batch prompts) vs automatic (Lead Satellite). */}
      <div className="flex items-center gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {t('scraper.mode.label')}
        </span>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['manual', 'auto'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSetScrapeMode?.(m)}
              className={[
                'rounded px-3 py-1 text-[11px] font-bold uppercase tracking-[0.06em] transition-colors',
                scrapeMode === m
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t(`scraper.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <CampaignTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={onSelectCampaign}
        showAction
        onActionClick={onCreateCampaign}
        loading={loadingCampaigns}
        onDeleteCampaign={onDeleteCampaign}
        />

      <GrowthCard
        title={t('scraper.leadsTitle', {
          campaign: selectedCampaignName ?? t('scraper.selectedCampaign'),
        })}
        hint={
          <div className="flex items-center gap-3">
            <span>
              {scrape
                ? t('scraper.scrapingHint')
                : t('scraper.companiesHint', { count: leads.length })}
            </span>
            {scrapeMode === 'manual' ? (
              selectedScrapePrompt ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setBatchOpen(true)}
                >
                  {t('scraper.runScrape')}
                </Button>
              ) : null
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={!selectedCampaignId || !!scrape}
                onClick={() =>
                  selectedCampaignId && onRunLeadSatellite?.(selectedCampaignId)
                }
              >
                {t('scraper.runSatellite')}
              </Button>
            )}
          </div>
        }
      >
        {scrape ? (
          <ScrapeCountdown
            startedAt={scrape.startedAt}
            etaSeconds={scrape.etaSeconds}
          />
        ) : loadingLeads ? (
          <Spinner label={t('scraper.loadingLeads')} />
        ) : scrapeError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="text-[12.5px] font-bold text-destructive">
              {t('scraper.failed')}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {scrapeError}
            </p>
          </div>
        ) : leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center text-[12.5px] font-bold text-muted-foreground">
            {t('scraper.empty')}
          </div>
        ) : (
          <>
          {/* State / Bundesland filter tabs — appear once the leads span >1 state. */}
          {statesPresent.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: t('scraper.stateTab.all'), count: leads.length },
                ...statesPresent.map((s) => ({
                  key: s,
                  label: s === '—' ? t('scraper.stateTab.none') : s,
                  count: leads.filter((l) => (l.state || '—') === s).length,
                })),
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStateFilter(tab.key)}
                  className={[
                    'rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors',
                    stateFilter === tab.key
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {tab.label}
                  <span className="ml-1.5 opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.company')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.contact')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.email')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.location')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.state')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.source')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.status')}
                </th>
              </tr>
            </thead>

            <tbody>
              {pageLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-t border-border hover:bg-muted"
                >
                  <td className="px-3 py-3 text-[12.5px] font-bold text-foreground">
                    {lead.company}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {lead.contact}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {lead.email}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {lead.location}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {lead.state}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {lead.source}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill live={lead.status === 'Interested'}>
                      {t(`scraper.leadStatus.${lead.status}`)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>

            {totalPages > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={7} className="px-3 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        {t('scraper.pagination', {
                          page: page + 1,
                          total: totalPages,
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          {t('scraper.prev')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page >= totalPages - 1}
                          onClick={() =>
                            setPage((p) => Math.min(totalPages - 1, p + 1))
                          }
                        >
                          {t('scraper.next')}
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
          </>
        )}
      </GrowthCard>

      <BatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        aimId={selectedCampaignId || null}
        campaignName={selectedCampaignName}
        onLeadsSaved={onLeadsSaved}
      />
    </div>
  );
}