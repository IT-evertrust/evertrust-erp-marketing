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
    <aside className="border-r border-border">
      <div className="flex flex-wrap gap-1.5 border-b border-border p-3.5">
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
        <div className="p-6 text-center text-[12.5px] font-bold text-muted-foreground">
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
                  'block w-full border-b border-border px-4 py-3 text-left hover:bg-muted',
                  selected
                    ? 'bg-sidebar-accent shadow-[inset_2px_0_0_var(--foreground)]'
                    : 'bg-card',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-bold text-foreground">
                    {reply.company}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {reply.time}
                  </span>
                </div>

                <div className="mt-1 text-[11px] text-muted-foreground">
                  {reply.contact}
                </div>

                <div className="mt-2 line-clamp-2 text-[11.5px] text-muted-foreground">
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
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function CategoryChip({ category }: { category: CampaignReply['category'] }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
      {category}
    </span>
  );
}