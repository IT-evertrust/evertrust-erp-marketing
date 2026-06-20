import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign, Lead } from '../types';
import { CampaignTable } from './campaign-table';
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
  scraping?: boolean;
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
  scraping = false,
}: LeadScraperPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <CampaignTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={onSelectCampaign}
        showAction
        actionLabel="Aim"
        onActionClick={onCreateCampaign}
        loading={loadingCampaigns}
        />

      <GrowthCard
        title={`Leads · ${selectedCampaignName ?? 'Selected Campaign'}`}
        hint={scraping ? 'SCRAPING…' : `${leads.length} COMPANIES`}
      >
        {scraping ? (
          <Spinner label="Lead Satellite is scraping leads…" />
        ) : loadingLeads ? (
          <Spinner label="Loading leads…" />
        ) : leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
            No leads loaded for this campaign yet.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Company
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Contact
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Location
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Source
                </th>
                <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Status
                </th>
              </tr>
            </thead>

            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-t border-[#e4e7eb] hover:bg-[#f6f7f9]"
                >
                  <td className="px-3 py-3 text-[12.5px] font-bold text-[#15171c]">
                    {lead.company}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                    {lead.contact}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                    {lead.location}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                    {lead.source}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill live={lead.status === 'Interested'}>
                      {lead.status}
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