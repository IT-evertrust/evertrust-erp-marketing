'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PipelineStage, ReachBoardLeadDto } from '@evertrust/shared';
import {
  useReachBoard,
  useUpdateReachLeadStage,
  useUpdateReachLeadDeal,
} from '@/hooks/use-reach-board';
import { cn } from '@/lib/utils';

// Big page so the kanban shows a meaningful slice of the pipeline at once.
const PAGE_SIZE = 500;

// The marketing department's pipeline (attached design) is a six-stage SALES funnel:
// INTEREST → INTENT → CONSIDERATION → DECISION → WON / LOST. Cards are grouped by the
// reach lead's `pipelineStage`; dragging a card to another column re-stages it, and the
// € value is inline-editable. The Nurture pipeline IS reach_leads now (no prospects).
const STAGES: Array<{
  key: PipelineStage;
  label: string;
  tone?: 'won' | 'lost';
}> = [
  { key: 'INTEREST', label: 'INTEREST' },
  { key: 'INTENT', label: 'INTENT' },
  { key: 'CONSIDERATION', label: 'CONSIDERATION' },
  { key: 'DECISION', label: 'DECISION' },
  { key: 'WON', label: 'WON', tone: 'won' },
  { key: 'LOST', label: 'LOST', tone: 'lost' },
];

// €X.XK above 1000 (one decimal), €NNN below — matches the design's column totals.
function formatEuros(value: number): string {
  if (value >= 1000) return `€${(value / 1000).toFixed(1)}K`;
  return `€${Math.round(value)}`;
}

// Faithful re-creation of the attached design's `.kanban.six`, white-themed with the
// app's light tokens. Six columns, each a stack of `.lead` cards with a per-column
// footer total (summed deal value). Data is REAL reach leads (GET /growth/reach/board);
// `items` is the niche/date-filtered slice the page hands down.
export function PipelineBoard({
  aimId,
  q: search,
  items: filteredItems,
}: {
  aimId?: string;
  q?: string;
  items?: ReachBoardLeadDto[];
}) {
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

  const query = useReachBoard({
    aimId,
    q: search,
    limit: PAGE_SIZE,
    offset: 0,
  });
  const items = useMemo(
    () => filteredItems ?? query.data?.items ?? [],
    [filteredItems, query.data],
  );
  const stageCounts = query.data?.stageCounts ?? {};

  const updateStage = useUpdateReachLeadStage();

  // Group the (filtered) page's leads into the six stages by pipelineStage.
  const byStage = useMemo(() => {
    const map = {} as Record<PipelineStage, ReachBoardLeadDto[]>;
    for (const s of STAGES) map[s.key] = [];
    for (const p of items) map[p.pipelineStage]?.push(p);
    return map;
  }, [items]);

  function handleDrop(stage: PipelineStage, id: string) {
    setDragOverStage(null);
    if (!id) return;
    const moving = items.find((p) => p.id === id);
    if (!moving || moving.pipelineStage === stage) return;
    updateStage.mutate({ id, stage });
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-white text-[12.5px] font-bold text-[#959ca7]">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading pipeline…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-[10px] border border-[#e4e7eb] bg-white px-6 py-10 text-center text-[12.5px] font-bold text-[#b91c1c]">
        Couldn’t load the pipeline. {query.error.message}
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="p-4">
        <div className="grid auto-rows-fr grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const cards = byStage[stage.key];
            const count = stageCounts[stage.key] ?? 0;
            const dealTotal = cards.reduce((sum, p) => sum + p.dealValue, 0);
            const isOver = dragOverStage === stage.key;
            return (
              <div
                key={stage.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverStage !== stage.key) setDragOverStage(stage.key);
                }}
                onDragLeave={(e) => {
                  // Only clear when leaving the column itself (not a child).
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverStage((s) => (s === stage.key ? null : s));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(stage.key, e.dataTransfer.getData('text/plain'));
                }}
                className={cn(
                  'flex min-h-[440px] flex-col rounded-[10px] border bg-[#f6f7f9] p-2.5 transition-colors',
                  isOver
                    ? 'border-[#15171c] bg-[#eef0f3]'
                    : 'border-[#e4e7eb]',
                )}
              >
                <div className="mb-[9px] flex items-center justify-between border-b border-[#e4e7eb] px-0.5 pb-[9px] text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
                  <b className="text-[#15171c]">{stage.label}</b>
                  <span className="rounded-full border border-[#d6dade] bg-[#eceef1] px-1.5 text-[#5b626d]">
                    {count}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-[3px]">
                  {cards.length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-[#d6dade] px-3 py-5 text-center text-[10.5px] font-bold text-[#bcc2cb]">
                      {stage.tone === 'won'
                        ? 'No closed-won deals yet'
                        : stage.key === 'DECISION'
                          ? 'Nothing in decision'
                          : 'Empty'}
                    </div>
                  ) : (
                    cards.map((p) => (
                      <LeadCard key={p.id} lead={p} tone={stage.tone} />
                    ))
                  )}
                </div>

                <div className="mt-[9px] border-t border-[#e4e7eb] pt-[9px] text-center">
                  <div className="text-[11.5px] font-bold text-[#15171c]">
                    Total: {formatEuros(dealTotal)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// One `.lead` card. Company (bold) on top, contact name below, and a footer row with
// the niche tag (left) + deal value €X.XK (right) — matching the design's `.lf`. WON
// cards get a ✓; LOST cards are dimmed. The whole card is draggable (re-stages on drop).
// The € value is an inline edit: click it → number input → blur/Enter saves.
function LeadCard({
  lead: p,
  tone,
}: {
  lead: ReachBoardLeadDto;
  tone?: 'won' | 'lost';
}) {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const updateDeal = useUpdateReachLeadDeal();

  const company = p.company || p.email || 'Unknown';

  function startEdit() {
    setDraft(String(p.dealValue));
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const next = Math.max(0, Math.round(Number(draft)));
    if (!Number.isFinite(next) || next === p.dealValue) return;
    updateDeal.mutate({ id: p.id, patch: { dealValue: next } });
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        setDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', p.id);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        'relative w-full rounded-[8px] border border-[#d6dade] bg-white p-2.5 text-left transition-colors hover:border-[#c2c7ce] hover:bg-[#fbfbfc]',
        tone === 'lost' ? 'opacity-60' : '',
        dragging ? 'opacity-40' : '',
      )}
    >
      <div className="truncate text-[12px] font-bold text-[#15171c]">
        {company}
        {tone === 'won' ? <span className="text-[#15171c]"> ✓</span> : null}
      </div>
      {p.contactName ? (
        <div className="mt-px truncate text-[10.5px] text-[#959ca7]">
          {p.contactName}
        </div>
      ) : null}

      <div className="mt-[9px] flex items-center justify-between gap-2">
        {p.niche ? (
          <span className="shrink-0 truncate rounded-[5px] border border-[#c2c7ce] px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#5b626d]">
            {p.niche}
          </span>
        ) : (
          <span />
        )}
        {editing ? (
          <input
            type="number"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-6 w-[88px] rounded-[5px] border border-[#c2c7ce] bg-white px-1.5 text-right text-[11px] font-bold text-[#15171c] outline-none focus-visible:border-[#15171c]"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startEdit();
            }}
            className="rounded-[5px] px-1 text-[11.5px] font-bold text-[#15171c] hover:bg-[#eceef1]"
            title="Edit deal value"
          >
            {formatEuros(p.dealValue)}
          </button>
        )}
      </div>
    </div>
  );
}
