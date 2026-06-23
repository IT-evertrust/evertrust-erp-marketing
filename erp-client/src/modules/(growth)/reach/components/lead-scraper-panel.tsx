'use client';

import { useTranslations } from 'next-intl';

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
              {leads.map((lead) => (
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
          </table>
        )}
      </GrowthCard>
    </div>
  );
}