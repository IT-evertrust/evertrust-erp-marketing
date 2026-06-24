import type { CategoryFilter } from '../hooks/use-engage';
import type { CampaignReply } from '../types';
import { Spinner } from './spinner';

type ReplyListProps = {
  replies: CampaignReply[];
  selectedReplyId: string;
  onSelectReply: (replyId: string) => void;
  categoryFilter: CategoryFilter;
  onSelectCategory: (category: CategoryFilter) => void;
  loading?: boolean;
  counts: {
    all: number;
    interested: number;
    unsure: number;
    temp: number;
    notInterested: number;
  };
};

export function ReplyList({
  replies,
  selectedReplyId,
  onSelectReply,
  categoryFilter,
  onSelectCategory,
  loading = false,
  counts,
}: ReplyListProps) {
  return (
    <aside className="border-r border-[#e4e7eb]">
      <div className="flex flex-wrap gap-1.5 border-b border-[#e4e7eb] p-3.5">
        <FilterChip
          active={categoryFilter === 'ALL'}
          onClick={() => onSelectCategory('ALL')}
        >
          All · {counts.all}
        </FilterChip>
        <FilterChip
          active={categoryFilter === 'INTERESTED'}
          onClick={() => onSelectCategory('INTERESTED')}
        >
          Interested · {counts.interested}
        </FilterChip>
        <FilterChip
          active={categoryFilter === 'UNSURE'}
          onClick={() => onSelectCategory('UNSURE')}
        >
          Unsure · {counts.unsure}
        </FilterChip>
        <FilterChip
          active={categoryFilter === 'TEMP'}
          onClick={() => onSelectCategory('TEMP')}
        >
          Temp · {counts.temp}
        </FilterChip>
        <FilterChip
          active={categoryFilter === 'NOT INTERESTED'}
          onClick={() => onSelectCategory('NOT INTERESTED')}
        >
          Not Interested · {counts.notInterested}
        </FilterChip>
      </div>

      {loading ? (
        <Spinner label="Loading replies…" />
      ) : replies.length === 0 ? (
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
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors',
        active
          ? 'border-[#15171c] bg-[#15171c] text-white'
          : 'border-[#c2c7ce] text-[#5b626d] hover:border-[#15171c] hover:text-[#15171c]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function CategoryChip({ category }: { category: CampaignReply['category'] }) {
  return (
    <span className="rounded-full border border-[#c2c7ce] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
      {category}
    </span>
  );
}