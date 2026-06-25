'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign, Lead } from '../types';
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
}: LeadScraperPanelProps) {
  const t = useTranslations('reach');

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  // Jump back to the first page when the operator switches campaigns.
  useEffect(() => {
    setPage(0);
  }, [selectedCampaignId]);
  // Clamp the page if the lead set shrinks (e.g. a rescan returns fewer rows).
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);
  const pageLeads = leads.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <CampaignTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={onSelectCampaign}
        showAction
        onActionClick={onCreateCampaign}
        loading={loadingCampaigns}
        />

      <GrowthCard
        title={t('scraper.leadsTitle', {
          campaign: selectedCampaignName ?? t('scraper.selectedCampaign'),
        })}
        hint={
          scrape
            ? t('scraper.scrapingHint')
            : t('scraper.companiesHint', { count: leads.length })
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
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.company')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.contact')}
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('scraper.col.location')}
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
                    {lead.location}
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
                  <td colSpan={5} className="px-3 pt-4">
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
        )}
      </GrowthCard>
    </div>
  );
}