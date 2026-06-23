'use client';

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