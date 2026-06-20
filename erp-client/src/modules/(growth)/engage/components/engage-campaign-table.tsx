import { GrowthCard, StatusPill } from '@/modules/(growth)/shared';

import type { EngageCampaign } from '../types';
import { Spinner } from './spinner';

type EngageCampaignTableProps = {
  campaigns: EngageCampaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  loading?: boolean;
};

export function EngageCampaignTable({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  loading = false,
}: EngageCampaignTableProps) {
  if (loading && campaigns.length === 0) {
    return (
      <GrowthCard title="Campaigns">
        <Spinner label="Loading campaigns…" />
      </GrowthCard>
    );
  }
  return (
    <GrowthCard title="Campaigns">
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
                Replies
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Status
              </th>
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => {
              const selected = selectedCampaignId === campaign.id;

              return (
                <tr
                  key={campaign.id}
                  onClick={() => onSelectCampaign(campaign.id)}
                  className={[
                    'cursor-pointer border-t border-[#e4e7eb] hover:bg-[#f6f7f9]',
                    selected
                      ? 'bg-[#f6f7f9] shadow-[inset_3px_0_0_#15171c]'
                      : '',
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
                    {campaign.replies}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill live={campaign.status === 'IN CAMPAIGN'}>
                      {campaign.status}
                    </StatusPill>
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