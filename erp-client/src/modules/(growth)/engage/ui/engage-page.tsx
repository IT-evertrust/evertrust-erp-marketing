'use client';

import { Loader2, RefreshCw } from 'lucide-react';

import { GrowthCard } from '@/modules/(growth)/shared';

import { EngageCampaignTable } from '../components/engage-campaign-table';
import { ReplyDetail } from '../components/reply-detail';
import { ReplyList } from '../components/reply-list';
import { useEngage } from '../hooks/use-engage';

export function EngagePage() {
  const engage = useEngage();

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-4 border-b border-[#e4e7eb]">
        <button
          type="button"
          className="mb-[-1px] border-b-2 border-[#15171c] px-4 py-3 text-[13px] font-bold text-[#15171c]"
        >
          Reply Sorter
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {engage.inboxes.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Inbox
              </span>
              <select
                value={engage.inboxFilter}
                onChange={(event) => engage.setInboxFilter(event.target.value)}
                className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c]"
              >
                <option value="">All inboxes</option>
                {engage.inboxes.map((inbox) => (
                  <option key={inbox} value={inbox}>
                    {inbox}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* F4: the salesperson persona reply drafts are written in. */}
          {engage.selectedCampaign && engage.personas.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Draft persona
              </span>
              <select
                value={engage.selectedCampaign.personaId ?? ''}
                onChange={(event) =>
                  engage.changePersona(event.target.value || null)
                }
                className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c]"
              >
                <option value="">Default voice</option>
                {engage.personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Manual "Scan now" — classify the selected campaign's mailbox for new
              replies. Slow on the local model, so it shows a spinner while running. */}
          <button
            type="button"
            onClick={engage.scanNow}
            disabled={!engage.selectedCampaignId || engage.scanning}
            className="ml-auto inline-flex items-center gap-1.5 rounded-[7px] border border-[#15171c] bg-[#15171c] px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#2a2d33] disabled:cursor-not-allowed disabled:opacity-50"
            title="Scan this campaign's inbox for new replies"
          >
            {engage.scanning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {engage.scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>

        <EngageCampaignTable
          campaigns={engage.campaigns}
          selectedCampaignId={engage.selectedCampaignId}
          onSelectCampaign={engage.setSelectedCampaignId}
          loading={engage.loadingCampaigns}
        />

        <GrowthCard title="Reply Sorter">
          <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-[#e4e7eb]">
            <ReplyList
              replies={engage.replies}
              selectedReplyId={engage.selectedReplyId}
              onSelectReply={engage.setSelectedReplyId}
              categoryFilter={engage.categoryFilter}
              onSelectCategory={engage.setCategoryFilter}
              loading={engage.loadingReplies}
              counts={engage.counts}
            />

            <ReplyDetail
              reply={engage.selectedReply}
              aiMode={engage.aiMode}
              onChangeAiMode={engage.setAiMode}
            />
          </div>
        </GrowthCard>
      </div>
    </main>
  );
}