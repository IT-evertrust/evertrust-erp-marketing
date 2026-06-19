import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign } from '../types';

type CampaignTableProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  title?: string;
  showAction?: boolean;
  actionLabel?: string;
  onActionClick?: () => void;
};

export function CampaignTable({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  title = 'Campaigns',
  showAction = false,
  actionLabel = 'Aim',
  onActionClick,
}: CampaignTableProps) {
  return (
    <GrowthCard
      title={title}
      hint={
        showAction ? (
            <button
            type="button"
            onClick={onActionClick}
            className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white"
            >
            {actionLabel}
            </button>
        ) : null
        }
    >
      <div className="max-h-[280px] overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Campaign
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Niche
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Region
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Companies
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
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
                    'cursor-pointer border-t border-[#e4e7eb] hover:bg-[#f6f7f9]',
                    selected ? 'bg-[#f6f7f9]' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-3 text-[12.5px] font-bold text-[#15171c]">
                    {campaign.name}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                    {campaign.niche}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                    {campaign.region}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
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
    </GrowthCard>
  );
}