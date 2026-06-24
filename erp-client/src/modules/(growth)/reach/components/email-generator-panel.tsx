'use client';

import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign, CampaignEmail, ReachRound } from '../types';
import { CampaignTable } from './campaign-table';

type EmailGeneratorPanelProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  emails: CampaignEmail[];
  loadingCampaigns?: boolean;
  onSend: (round: ReachRound) => void;
  // True when the selected campaign's templates are the org-wide default. The
  // bodies become read-only and an info banner explains where to edit them.
  usingOrgDefault?: boolean;
};

export function EmailGeneratorPanel({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  emails,
  loadingCampaigns = false,
  onSend,
  usingOrgDefault = false,
}: EmailGeneratorPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <CampaignTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={onSelectCampaign}
        loading={loadingCampaigns}
        metricLabel="Sent"
        metricValue={(c) => c.sent}
      />

      <GrowthCard title="Emails">
        {emails.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
            No templates generated yet. Launch an Aim to generate the cold
            outreach, follow up, and final push.
          </div>
        ) : (
        <div className="flex flex-col gap-4">
          {usingOrgDefault ? (
            <div className="rounded-lg border border-[#d6dade] bg-[#f6f7f9] p-3 text-[11.5px] font-bold text-[#5b626d]">
              Showing the org-wide default template. Edit it in the Templates tab
              — per-campaign edits here are not used.
            </div>
          ) : null}
          {emails.map((email) => {
            const sent = email.sent || 1;

            return (
              <div
                key={email.id}
                className="border-b border-dashed border-[#d6dade] pb-4 last:border-b-0 last:pb-0"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-bold text-[#15171c]">
                      {email.step}{' '}
                      <span className="text-[11px] font-normal text-[#959ca7]">
                        · {email.round}
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-[#959ca7]">
                      {email.subject}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <StatusPill live={email.status === 'SENT'}>
                      {email.status}
                    </StatusPill>
                    <button
                      type="button"
                      onClick={() => onSend(email.id as ReachRound)}
                      className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:opacity-90"
                    >
                      Send
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
                  {usingOrgDefault ? (
                    <div className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-[#d6dade] bg-[#f6f7f9] p-3 text-[12.5px] leading-relaxed text-[#15171c]">
                      {`Subject: ${email.subject}\n\n${email.body ?? ''}`}
                    </div>
                  ) : (
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-[#d6dade] bg-[#f6f7f9] p-3 text-[12.5px] leading-relaxed text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
                    >
                      {`Subject: ${email.subject}\n\n${email.body ?? ''}`}
                    </div>
                  )}

                  <div className="rounded-lg border border-[#d6dade] bg-[#f6f7f9] p-3">
                    <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                      Performance
                    </div>

                    <Metric label="Sent" value={email.sent} percent={100} />
                    <Metric
                      label="Opened"
                      value={email.opened}
                      percent={(email.opened / sent) * 100}
                    />
                    <Metric
                      label="Clicked"
                      value={email.clicked}
                      percent={(email.clicked / sent) * 100}
                    />
                    <Metric
                      label="Replied"
                      value={email.replied}
                      percent={(email.replied / sent) * 100}
                    />
                    <Metric
                      label="Bounced"
                      value={email.bounced}
                      percent={(email.bounced / sent) * 100}
                    />

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-[#d6dade] bg-white px-3 py-2">
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                        Meetings
                      </span>
                      <b className="text-[18px] text-[#15171c]">
                        {email.meetings}
                      </b>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </GrowthCard>
    </div>
  );
}

function Metric({
  label,
  value,
  percent,
}: {
  label: string;
  value: number;
  percent: number;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="mb-2 grid grid-cols-[64px_40px_1fr_46px] items-center gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
        {label}
      </span>
      <span className="text-right text-[13px] font-bold text-[#15171c]">
        {value}
      </span>
      <span className="h-2 overflow-hidden rounded-full border border-[#d6dade] bg-[#eceef1]">
        <span
          className="block h-full bg-[#15171c]"
          style={{ width: `${safePercent}%` }}
        />
      </span>
      <span className="text-right text-[11px] font-bold text-[#5b626d]">
        {Math.round(safePercent)}%
      </span>
    </div>
  );
}