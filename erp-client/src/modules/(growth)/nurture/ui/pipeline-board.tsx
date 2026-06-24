'use client';

import { useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PipelineStage, ReachBoardLeadDto } from '@evertrust/shared';
import {
  useCreateReachLead,
  useDeleteReachLead,
  useReachBoard,
  useUpdateReachLeadStage,
  useUpdateReachLeadDeal,
} from '@/hooks/use-reach-board';
import { Spinner } from '@/modules/(growth)/shared';
import { cn } from '@/lib/utils';

// Big page so the kanban shows a meaningful slice of the pipeline at once.
const PAGE_SIZE = 500;

// The marketing department's pipeline (attached design) is a six-stage SALES funnel:
// INTEREST → INTENT → CONSIDERATION → DECISION → WON / LOST. Cards are reach leads,
// dragged between columns via the top-right grip, with an × to delete on hover, an
// inline-editable company + € value, and a per-column "+ Add deal".
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

export type BoardCampaign = { id: string; niche: string; name: string };

export function PipelineBoard({
  aimId,
  q: search,
  items: filteredItems,
  campaigns = [],
}: {
  aimId?: string;
  q?: string;
  items?: ReachBoardLeadDto[];
  // The org's campaigns (Reach AIMs) — for the per-card "attach a campaign" selector.
  campaigns?: BoardCampaign[];
}) {
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

  const query = useReachBoard({ aimId, q: search, limit: PAGE_SIZE, offset: 0 });
  const items = useMemo(
    () => filteredItems ?? query.data?.items ?? [],
    [filteredItems, query.data],
  );
  const stageCounts = query.data?.stageCounts ?? {};

  const updateStage = useUpdateReachLeadStage();
  const createLead = useCreateReachLead();

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

  // "+ Add deal": creates a card in this stage. If a campaign is selected above it's
  // attached now; otherwise the deal starts unassigned and a campaign can be attached
  // later from the card's campaign selector.
  function handleAddDeal(stage: PipelineStage) {
    createLead.mutate(
      { aimId: aimId || undefined, pipelineStage: stage, company: 'New deal' },
      { onError: (e) => toast.error(e.message || 'Could not add the deal.') },
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-white">
        <Spinner label="Loading pipeline…" />
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
                  isOver ? 'border-[#15171c] bg-[#eef0f3]' : 'border-[#e4e7eb]',
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
                      <LeadCard
                        key={p.id}
                        lead={p}
                        tone={stage.tone}
                        campaigns={campaigns}
                      />
                    ))
                  )}

                  {/* + Add deal (mock's .addlead) — appends a card to this stage. */}
                  <button
                    type="button"
                    onClick={() => handleAddDeal(stage.key)}
                    disabled={createLead.isPending}
                    className="mt-1 flex items-center justify-center gap-1 rounded-[8px] border border-dashed border-[#c2c7ce] py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#959ca7] transition-colors hover:border-[#15171c] hover:text-[#15171c] disabled:opacity-50"
                  >
                    <Plus className="size-3" />
                    Add deal
                  </button>
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

// One `.lead` card. Company (bold, inline-editable) on top, contact name + phone, and
// a footer row with the niche tag (left) + deal value €X.XK (right). A top-right grip
// drags the card to another stage; an × (on hover) deletes it. WON cards get a ✓;
// LOST cards are dimmed.
function LeadCard({
  lead: p,
  tone,
  campaigns,
}: {
  lead: ReachBoardLeadDto;
  tone?: 'won' | 'lost';
  campaigns: BoardCampaign[];
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState('');
  const updateDeal = useUpdateReachLeadDeal();
  const deleteLead = useDeleteReachLead();

  const company = p.company || p.email || 'Unknown';

  function commitDeal() {
    setEditing(false);
    const next = Math.max(0, Math.round(Number(draft)));
    if (!Number.isFinite(next) || next === p.dealValue) return;
    updateDeal.mutate({ id: p.id, patch: { dealValue: next } });
  }

  function commitCompany() {
    setEditingCompany(false);
    const next = companyDraft.trim();
    if (!next || next === p.company) return;
    updateDeal.mutate({ id: p.id, patch: { company: next } });
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative w-full rounded-[8px] border border-[#d6dade] bg-white p-2.5 text-left transition-colors hover:border-[#c2c7ce]',
        tone === 'lost' ? 'opacity-60' : '',
        dragging ? 'opacity-40' : '',
      )}
    >
      {/* delete × — appears on hover, left of the grip */}
      <button
        type="button"
        title="Remove deal"
        onClick={() => deleteLead.mutate({ id: p.id })}
        className="absolute right-[26px] top-1.5 grid size-4 place-items-center rounded text-[#959ca7] opacity-0 transition group-hover:opacity-100 hover:bg-[#f6f7f9] hover:text-[#c0392b]"
      >
        <X className="size-3.5" />
      </button>

      {/* grip — the drag handle (drags the whole card to another stage) */}
      <span
        draggable
        title="Drag to another stage"
        onDragStart={(e) => {
          setDragging(true);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', p.id);
          if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 14, 14);
        }}
        onDragEnd={() => setDragging(false)}
        className="absolute right-2 top-2 cursor-grab text-[#8a9099] opacity-50 transition hover:opacity-95 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </span>

      {editingCompany ? (
        <input
          autoFocus
          value={companyDraft}
          onChange={(e) => setCompanyDraft(e.target.value)}
          onBlur={commitCompany}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitCompany();
            if (e.key === 'Escape') setEditingCompany(false);
          }}
          className="w-[calc(100%-34px)] rounded-[4px] border border-[#c2c7ce] px-1 text-[12px] font-bold text-[#15171c] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setCompanyDraft(p.company ?? '');
            setEditingCompany(true);
          }}
          title="Edit company"
          className="block max-w-[calc(100%-34px)] truncate pr-1 text-left text-[12px] font-bold text-[#15171c] hover:underline"
        >
          {company}
          {tone === 'won' ? <span className="text-[#15171c]"> ✓</span> : null}
        </button>
      )}

      {p.contactName ? (
        <div className="mt-px truncate text-[10.5px] text-[#959ca7]">
          {p.contactName}
        </div>
      ) : null}

      {/* phone row (mock's .ph) */}
      {p.phone ? (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded-[4px] border border-[#d6dade] px-1 text-[8px] font-bold leading-[14px] tracking-[0.06em] text-[#959ca7]">
            TEL
          </span>
          <span className="text-[10.5px] font-semibold text-[#5b626d]">
            {p.phone}
          </span>
        </div>
      ) : null}

      <div className="mt-[9px] flex items-center justify-between gap-2">
        {/* Campaign selector (mock's select.tag): shows the niche, lets you attach or
            change the deal's campaign — so a deal added unassigned gets one later. */}
        <select
          value={p.aimId ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            updateDeal.mutate({
              id: p.id,
              patch: { aimId: e.target.value || null },
            })
          }
          title="Campaign"
          className="min-w-0 max-w-[60%] shrink truncate rounded-[5px] border border-[#c2c7ce] bg-white py-px pl-[5px] pr-3 text-[9px] font-bold uppercase tracking-[0.05em] text-[#5b626d] outline-none"
        >
          <option value="">+ Campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.niche || c.name}
            </option>
          ))}
        </select>
        {editing ? (
          <input
            type="number"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDeal}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDeal();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-6 w-[88px] rounded-[5px] border border-[#c2c7ce] bg-white px-1.5 text-right text-[11px] font-bold text-[#15171c] outline-none focus-visible:border-[#15171c]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(p.dealValue));
              setEditing(true);
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
