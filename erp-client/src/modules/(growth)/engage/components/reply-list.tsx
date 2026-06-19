import type { CampaignReply } from '../types';

type ReplyListProps = {
  replies: CampaignReply[];
  selectedReplyId: string;
  onSelectReply: (replyId: string) => void;
  counts: {
    all: number;
    interested: number;
    unsure: number;
    notInterested: number;
  };
};

export function ReplyList({
  replies,
  selectedReplyId,
  onSelectReply,
  counts,
}: ReplyListProps) {
  return (
    <aside className="border-r border-[#e4e7eb]">
      <div className="flex flex-wrap gap-1.5 border-b border-[#e4e7eb] p-3.5">
        <FilterChip active>All · {counts.all}</FilterChip>
        <FilterChip>Interested · {counts.interested}</FilterChip>
        <FilterChip>Unsure · {counts.unsure}</FilterChip>
        <FilterChip>Not Interested · {counts.notInterested}</FilterChip>
      </div>

      {replies.length === 0 ? (
        <div className="p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
          No replies yet for this campaign.
        </div>
      ) : (
        <div>
          {replies.map((reply) => {
            const selected = selectedReplyId === reply.id;

            return (
              <button
                key={reply.id}
                type="button"
                onClick={() => onSelectReply(reply.id)}
                className={[
                  'block w-full border-b border-[#e4e7eb] px-4 py-3 text-left hover:bg-[#f6f7f9]',
                  selected
                    ? 'bg-[#f6f7f9] shadow-[inset_2px_0_0_#15171c]'
                    : 'bg-white',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-bold text-[#15171c]">
                    {reply.company}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#959ca7]">
                    {reply.time}
                  </span>
                </div>

                <div className="mt-1 text-[11px] text-[#959ca7]">
                  {reply.contact}
                </div>

                <div className="mt-2 line-clamp-2 text-[11.5px] text-[#5b626d]">
                  {reply.inboundPreview}
                </div>

                <div className="mt-2">
                  <CategoryChip category={reply.category} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function FilterChip({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={[
        'rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em]',
        active
          ? 'border-[#15171c] bg-[#15171c] text-white'
          : 'border-[#c2c7ce] text-[#5b626d]',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

function CategoryChip({ category }: { category: CampaignReply['category'] }) {
  return (
    <span className="rounded-full border border-[#c2c7ce] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
      {category}
    </span>
  );
}