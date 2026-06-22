import { GrowthCard, StatusPill } from '@/modules/(growth)/shared';

import type { EngageCampaign } from '../types';

type EngageCampaignTableProps = {
  campaigns: EngageCampaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
};

export function EngageCampaignTable({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
}: EngageCampaignTableProps) {
  return (
    <GrowthCard title="Campaigns">
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
                Replies
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
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