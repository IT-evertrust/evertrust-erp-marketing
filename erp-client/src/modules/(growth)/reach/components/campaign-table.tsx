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
  title = 'Campaigns',
  showAction = false,
  actionLabel = 'Aim',
  onActionClick,
  loading = false,
}: CampaignTableProps) {
  return (
    <GrowthCard
      title={title}
      hint={
        showAction ? (
            <button
            type="button"
            onClick={onActionClick}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background"
            >
            {actionLabel}
            </button>
        ) : null
        }
    >
      {loading && campaigns.length === 0 ? (
        <Spinner label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center text-[12.5px] font-bold text-muted-foreground">
          No campaigns yet. Click Aim to launch one.
        </div>
      ) : (
      <div className="max-h-[280px] overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Campaign
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Niche
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Region
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Companies
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => {
              const selected = selectedCampaignId === campaign.id;
              const live = campaign.status === 'IN CAMPAIGN';

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
                    <StatusPill live={live}>{campaign.status}</StatusPill>
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