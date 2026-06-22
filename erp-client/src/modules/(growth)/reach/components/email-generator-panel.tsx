'use client';

import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign, CampaignEmail, ReachRound } from '../types';
import { CampaignTable } from './campaign-table';

type EmailGeneratorPanelProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  selectedCampaignName?: string;
  emails: CampaignEmail[];
  loadingCampaigns?: boolean;
  onSend: (round: ReachRound) => void;
};

export function EmailGeneratorPanel({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  selectedCampaignName,
  emails,
  loadingCampaigns = false,
  onSend,
}: EmailGeneratorPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <CampaignTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={onSelectCampaign}
        loading={loadingCampaigns}
      />

      <GrowthCard title={`Emails · ${selectedCampaignName ?? 'Campaign'}`}>
        {emails.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center text-[12.5px] font-bold text-muted-foreground">
            No templates generated yet. Launch an Aim to generate the cold
            outreach, follow up, and final push.
          </div>
        ) : (
        <div className="flex flex-col gap-4">
          {emails.map((email) => {
            const sent = email.sent || 1;

            return (
              <div
                key={email.id}
                className="border-b border-dashed border-border pb-4 last:border-b-0 last:pb-0"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-bold text-foreground">
                      {email.step}{' '}
                      <span className="text-[11px] font-normal text-muted-foreground">
                        · {email.round}
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
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
                      className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background hover:opacity-90"
                    >
                      Send
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 text-[12.5px] leading-relaxed text-foreground outline-none focus:border-foreground focus:bg-background"
                  >
                    {`Subject: ${email.subject}\n\n${email.body ?? ''}`}
                  </div>

                  <div className="rounded-lg border border-border bg-muted p-3">
                    <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
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

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Meetings
                      </span>
                      <b className="text-[18px] text-foreground">
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
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-[13px] font-bold text-foreground">
        {value}
      </span>
      <span className="h-2 overflow-hidden rounded-full border border-border bg-muted">
        <span
          className="block h-full bg-foreground"
          style={{ width: `${safePercent}%` }}
        />
      </span>
      <span className="text-right text-[11px] font-bold text-muted-foreground">
        {Math.round(safePercent)}%
      </span>
    </div>
  );
}