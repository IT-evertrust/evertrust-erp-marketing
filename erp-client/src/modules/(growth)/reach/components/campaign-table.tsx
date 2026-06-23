'use client';

import { useTranslations } from 'next-intl';

import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign } from '../types';
import { Spinner } from './spinner';

type CampaignTableProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  title?: string;
  showAction?: boolean;
  actionLabel?: string;
  onActionClick?: () => void;
  loading?: boolean;
};

export function CampaignTable({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  title,
  showAction = false,
  actionLabel,
  onActionClick,
  loading = false,
}: CampaignTableProps) {
  const t = useTranslations('reach');

  return (
    <GrowthCard
      title={title ?? t('campaignTable.title')}
      hint={
        showAction ? (
            <button
            type="button"
            onClick={onActionClick}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background"
            >
            {actionLabel ?? t('campaignTable.aim')}
            </button>
        ) : null
        }
    >
      {loading && campaigns.length === 0 ? (
        <Spinner label={t('campaignTable.loading')} />
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center text-[12.5px] font-bold text-muted-foreground">
          {t('campaignTable.empty')}
        </div>
      ) : (
      <div className="max-h-[280px] overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.campaign')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.niche')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.region')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.companies')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.status')}
              </th>
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => {
              const selected = selectedCampaignId === campaign.id;
              const live =
                campaign.status === 'IN CAMPAIGN' ||
                campaign.status === 'SCRAPING';

              return (
                <tr
                  key={campaign.id}
                  onClick={() => onSelectCampaign(campaign.id)}
                  className={[
                    'cursor-pointer border-t border-border hover:bg-muted',
                    selected ? 'bg-muted' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-3 text-[12.5px] font-bold text-foreground">
                    {campaign.name}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {campaign.niche}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {campaign.region}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {campaign.companies}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill live={live}>
                      {t(`campaignTable.status.${campaign.status}`)}
                    </StatusPill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </GrowthCard>
  );
}