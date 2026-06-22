'use client';

import { GrowthCard } from '@/modules/(growth)/shared';

import { EngageCampaignTable } from '../components/engage-campaign-table';
import { ReplyDetail } from '../components/reply-detail';
import { ReplyList } from '../components/reply-list';
import { useEngage } from '../hooks/use-engage';

export function EngagePage() {
  const engage = useEngage();

  return (
    <main className="px-6 py-5">
      <div className="mb-4 border-b border-border">
        <button
          type="button"
          className="mb-[-1px] border-b-2 border-foreground px-4 py-3 text-[13px] font-bold text-foreground"
        >
          Reply Sorter
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <EngageCampaignTable
          campaigns={engage.campaigns}
          selectedCampaignId={engage.selectedCampaignId}
          onSelectCampaign={engage.setSelectedCampaignId}
        />

        <GrowthCard title="Reply Sorter">
          <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-border">
            <ReplyList
              replies={engage.replies}
              selectedReplyId={engage.selectedReplyId}
              onSelectReply={engage.setSelectedReplyId}
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