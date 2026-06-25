'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import {
  PIPELINE_STAGE_ORDER,
  type CampaignDto,
  type PipelineStage,
  type ProspectDto,
  type UpdateProspectCardDto,
} from '@evertrust/shared';
import {
  useProspectsBoard,
  useUpdateProspectStage,
  useUpdateProspectDeal,
  useCreateProspectCard,
  useUpdateProspectCard,
  useDeleteProspect,
} from '@/hooks/use-prospects';
import { useNicheTargets } from '@/hooks/use-niche-targets';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { NicheSelect } from './niche-select';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

const ALL = 'all';

function campaignLabel(c: CampaignDto): string {
  return c.name || c.project || c.nicheName || c.region;
}

// Compact euro label for a whole-euro amount: €0, €950, €2.5K, €12.5K, €3.4M.
// Drops a trailing ".0" so €2K reads cleanly. Negatives are clamped to 0.
function formatEuros(value: number): string {
  const v = Math.max(0, Math.round(value));
  if (v < 1_000) return `€${v}`;
  const compact = (n: number, suffix: string) =>
    `€${n.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (v < 1_000_000) return compact(v / 1_000, 'K');
  return compact(v / 1_000_000, 'M');
}

// The Nurture "Sales Pipeline" board: a 6-stage kanban (Interest → Lost) the team
// drags deals through by hand. Distinct from the agent-driven outreach status (shown
// as a card badge). Filter row: campaign, niche target, company/email search, and a
// created-date range. Drag uses a DragOverlay so the card follows the pointer smoothly
// (the in-place card only dims) — no per-move grid reflow.
export function NurturePipelineBoard({
  campaigns,
  campaignId,
  onCampaignChange,
  nicheId,
}: {
  campaigns: CampaignDto[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  nicheId: string | null;
}) {
  const t = useTranslations('nurture');
  const [search, setSearch] = useState('');
  const [nicheTargetId, setNicheTargetId] = useState<string>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The card whose company field should auto-focus into edit mode (a freshly added
  // deal). Consumed once by that card's editor, then cleared.
  const [focusId, setFocusId] = useState<string | null>(null);

  const targetsQ = useNicheTargets(nicheId, !!nicheId);
  const setStage = useUpdateProspectStage();
  const updateDeal = useUpdateProspectDeal();
  const createCard = useCreateProspectCard();
  const updateCard = useUpdateProspectCard();
  const deleteProspect = useDeleteProspect();

  const q = useProspectsBoard({
    campaignId,
    q: search || undefined,
    nicheTargetId: nicheTargetId === ALL ? undefined : nicheTargetId,
    createdFrom: from ? `${from}T00:00:00.000Z` : undefined,
    createdTo: to ? `${to}T23:59:59.999Z` : undefined,
    limit: 500,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const byStage = useMemo(() => {
    const map: Record<PipelineStage, ProspectDto[]> = {
      INTEREST: [],
      INTENT: [],
      CONSIDERATION: [],
      DECISION: [],
      WON: [],
      LOST: [],
    };
    for (const p of items) map[p.pipelineStage].push(p);
    return map;
  }, [items]);

  // Per-column € total: sum each stage's cards' dealValue, computed client-side from
  // the grouped cards already in the board.
  const stageTotals = useMemo(() => {
    const map = {} as Record<PipelineStage, number>;
    for (const stage of PIPELINE_STAGE_ORDER) {
      map[stage] = byStage[stage].reduce((sum, p) => sum + (p.dealValue ?? 0), 0);
    }
    return map;
  }, [byStage]);

  const counts = q.data?.stageCounts ?? {};
  const activeCard = useMemo(
    () => items.find((p) => p.id === activeId) ?? null,
    [items, activeId],
  );

  // A small activation distance so a click opens the drawer and only a real drag moves.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const dest = e.over?.id as PipelineStage | undefined;
    if (!dest) return;
    const card = items.find((p) => p.id === id);
    if (!card || card.pipelineStage === dest) return;
    setStage.mutate(
      { id, patch: { pipelineStage: dest } },
      {
        onSuccess: () =>
          toast.success(
            t('pipeline.movedToast', {
              name: card.companyName ?? card.email,
              stage: t(`pipeline.stages.${dest}`),
            }),
          ),
        onError: (err) => toast.error(err.message ?? t('pipeline.moveError')),
      },
    );
  }

  // Inline deal-value save (blur/Enter from a card). No-op when unchanged.
  function onSaveDeal(card: ProspectDto, dealValue: number) {
    if (dealValue === card.dealValue) return;
    updateDeal.mutate(
      { id: card.id, dealValue },
      {
        onError: (err) => toast.error(err.message ?? t('pipeline.dealError')),
      },
    );
  }

  // Inline card-field save (company / contact / phone / niche) from a card editor.
  // The mutation is optimistic, so the patched field sticks instantly.
  function onSaveCard(id: string, patch: UpdateProspectCardDto) {
    updateCard.mutate(
      { id, patch },
      {
        onError: (err) => toast.error(err.message ?? t('pipeline.saveError')),
      },
    );
  }

  // "+ Add deal" — create a blank card in a column and flag it to auto-focus its
  // company field once it renders.
  function onAddDeal(stage: PipelineStage) {
    createCard.mutate(
      { campaignId, pipelineStage: stage },
      {
        onSuccess: (card) => {
          setFocusId(card.id);
          toast.success(t('pipeline.addedToast'));
        },
        onError: (err) => toast.error(err.message ?? t('pipeline.addError')),
      },
    );
  }

  // Delete a card with a lightweight confirm so a misclick doesn't remove it.
  function onDeleteCard(card: ProspectDto) {
    const name = card.companyName ?? card.email;
    if (!window.confirm(t('pipeline.deleteConfirm', { name }))) return;
    deleteProspect.mutate(
      { id: card.id },
      {
        onSuccess: () => {
          if (openId === card.id) setOpenId(null);
          toast.success(t('pipeline.deletedToast', { name }));
        },
        onError: (err) => toast.error(err.message ?? t('pipeline.deleteError')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* filters: campaign + niche + search + date range */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={campaignId} onValueChange={onCampaignChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {campaignLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {nicheId ? (
          <Select value={nicheTargetId} onValueChange={setNicheTargetId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t('pipeline.filters.allNiches')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('pipeline.filters.allNiches')}
              </SelectItem>
              {(targetsQ.data ?? []).map((nt) => (
                <SelectItem key={nt.id} value={nt.id}>
                  {nt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pipeline.filters.search')}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('pipeline.filters.from')}
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[150px]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('pipeline.filters.to')}
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[150px]"
          />
        </label>
        {(search || nicheTargetId !== ALL || from || to) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setNicheTargetId(ALL);
              setFrom('');
              setTo('');
            }}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('pipeline.filters.clear')}
          </button>
        )}
      </div>

      {/* board */}
      {q.isLoading ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">{q.error.message}</p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {PIPELINE_STAGE_ORDER.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                label={t(`pipeline.stages.${stage}`)}
                count={counts[stage] ?? byStage[stage].length}
                total={formatEuros(stageTotals[stage])}
                emptyLabel={t('pipeline.columnEmpty')}
                addLabel={t('pipeline.addDeal')}
                onAdd={() => onAddDeal(stage)}
                adding={createCard.isPending}
              >
                {byStage[stage].map((p) => (
                  <ProspectCard
                    key={p.id}
                    p={p}
                    onOpen={() => setOpenId(p.id)}
                    onSaveDeal={(v) => onSaveDeal(p, v)}
                    onSaveCard={onSaveCard}
                    onDelete={() => onDeleteCard(p)}
                    autoFocusCompany={p.id === focusId}
                    onFocusConsumed={() => setFocusId(null)}
                    deleteLabel={t('pipeline.deleteCard')}
                    dealLabel={t('pipeline.dealLabel')}
                    companyPlaceholder={t('pipeline.companyPlaceholder')}
                    contactPlaceholder={t('pipeline.contactPlaceholder')}
                    phonePlaceholder={t('pipeline.phonePlaceholder')}
                  />
                ))}
              </StageColumn>
            ))}
          </div>
          {/* The floating card follows the pointer; dropAnimation off = instant drop. */}
          <DragOverlay dropAnimation={null}>
            {activeCard ? <CardView p={activeCard} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <ProspectDetailDrawer
        prospectId={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
    </div>
  );
}

function StageColumn({
  stage,
  label,
  count,
  total,
  emptyLabel,
  addLabel,
  onAdd,
  adding,
  children,
}: {
  stage: PipelineStage;
  label: string;
  count: number;
  total: string;
  emptyLabel: string;
  addLabel: string;
  onAdd: () => void;
  adding: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const empty = Array.isArray(children) && children.length === 0;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[16rem] flex-col rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9] p-[10px] transition-colors',
        isOver && 'border-[#959ca7] bg-[#eceef1]',
      )}
    >
      <div className="mb-[9px] flex items-center justify-between gap-2 border-b border-[#e4e7eb] px-0.5 pb-[9px]">
        <b className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#15171c]">
          {label}
        </b>
        <span className="rounded-[20px] border border-[#d6dade] bg-[#eceef1] px-[6px] text-[11px] font-bold tabular-nums text-[#5b626d]">
          {count}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {empty ? (
          <p className="px-1 py-6 text-center text-xs text-[#959ca7]">
            {emptyLabel}
          </p>
        ) : (
          children
        )}
        {/* "+ Add deal" — a dashed full-width button under the column's cards. */}
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-[8px] border border-dashed border-[#c2c7ce] px-2 py-1.5 text-[11px] font-semibold text-[#5b626d] transition-colors hover:border-[#959ca7] hover:bg-white disabled:opacity-50"
        >
          <Plus className="size-3" />
          {addLabel}
        </button>
      </div>
      <div className="mt-[9px] border-t border-[#e4e7eb] pt-[9px] text-center">
        <div className="text-[11.5px] font-bold text-[#15171c]">
          Total: {total}
        </div>
      </div>
    </div>
  );
}

// Stop a pointer/mouse event from reaching the draggable wrapper (no drag start) AND
// from bubbling to the card's onClick (no drawer open). Used on the deal input and
// delete control so they behave as plain form controls, not drag handles.
function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// Inline-editable € deal value: shows the formatted amount; click to edit a number
// input; blur/Enter saves (Escape cancels). Not draggable — swallows pointer/click so
// it neither starts a drag nor opens the drawer. Read-only when onSave is omitted (the
// drag overlay), where it renders as static text.
function DealValue({
  value,
  label,
  onSave,
}: {
  value: number;
  label: string;
  onSave?: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!onSave) {
    return (
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {formatEuros(value)}
      </span>
    );
  }

  function commit() {
    setEditing(false);
    const parsed = Math.max(0, Math.round(Number(draft)));
    if (Number.isFinite(parsed) && parsed !== value) onSave?.(parsed);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type="number"
        min={0}
        inputMode="numeric"
        value={draft}
        aria-label={label}
        onPointerDown={stop}
        onClick={stop}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(String(value));
            setEditing(false);
          }
        }}
        className="h-6 w-20 px-1.5 py-0 text-xs tabular-nums"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={stop}
      onClick={(e) => {
        stop(e);
        setDraft(String(value));
        setEditing(true);
      }}
      className="rounded px-1 text-xs font-semibold tabular-nums text-foreground hover:bg-muted"
    >
      {formatEuros(value)}
    </button>
  );
}

// Inline-editable single-line text on a card (company / contact / phone). Click the
// text to turn it into an input; blur/Enter saves the trimmed value (mapped to null
// when emptied) only when it changed (Escape cancels). Swallows pointer/click so it
// neither starts a drag nor opens the drawer. `autoFocus` enters edit mode on mount
// (a freshly added card's company field). When `placeholder` is shown for an empty
// value the text is muted.
function EditableText({
  value,
  placeholder,
  className,
  autoFocus,
  onAutoFocusConsumed,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
  onAutoFocusConsumed?: () => void;
  onSave: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  // Enter edit mode once when flagged (the just-added card's company field).
  useEffect(() => {
    if (autoFocus) {
      setDraft(value ?? '');
      setEditing(true);
      onAutoFocusConsumed?.();
    }
    // Only react to the flag flipping on; value/onAutoFocusConsumed are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function commit() {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== (value ?? null)) onSave(next);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        aria-label={placeholder}
        placeholder={placeholder}
        onPointerDown={stop}
        onClick={stop}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
        className="h-6 w-full px-1.5 py-0 text-xs"
      />
    );
  }

  return (
    <button
      type="button"
      title={placeholder}
      onPointerDown={stop}
      onClick={(e) => {
        stop(e);
        setDraft(value ?? '');
        setEditing(true);
      }}
      className={cn(
        'block w-full truncate rounded px-0.5 text-left hover:bg-[#f6f7f9]',
        !value && 'text-[#959ca7]',
        className,
      )}
    >
      {value?.trim() || placeholder}
    </button>
  );
}

// The deal card — memoized; reused for both the in-column card and the drag overlay.
// When the editor props (onSaveCard/onSaveDeal/onDelete) are passed (the in-column
// card) the company / contact / phone fields are click-to-edit, the niche tag is a
// pick-or-create dropdown, the € value is inline-editable and a hover delete control
// appears. The drag overlay passes none of them, so it renders static read-only text.
const CardView = memo(function CardView({
  p,
  dragging,
  onSaveCard,
  onSaveDeal,
  onDelete,
  autoFocusCompany,
  onFocusConsumed,
  deleteLabel,
  dealLabel,
  companyPlaceholder,
  contactPlaceholder,
  phonePlaceholder,
}: {
  p: ProspectDto;
  dragging?: boolean;
  onSaveCard?: (id: string, patch: UpdateProspectCardDto) => void;
  onSaveDeal?: (dealValue: number) => void;
  onDelete?: () => void;
  autoFocusCompany?: boolean;
  onFocusConsumed?: () => void;
  deleteLabel?: string;
  dealLabel?: string;
  companyPlaceholder?: string;
  contactPlaceholder?: string;
  phonePlaceholder?: string;
}) {
  const isWon = p.pipelineStage === 'WON';
  const isLost = p.pipelineStage === 'LOST';
  // Static (drag overlay) — the niche pill falls back to the resolved target name.
  const editable = !!onSaveCard;
  const nicheTag = (p.niche ?? p.nicheTargetName)?.trim();
  const location = [p.city, p.country].filter(Boolean).join(', ');

  return (
    <div
      className={cn(
        'group/card relative rounded-[8px] border border-[#d6dade] bg-white p-[10px] text-left',
        isLost && 'opacity-60',
        dragging && 'cursor-grabbing shadow-lg ring-1 ring-[#15171c]/30',
      )}
    >
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={deleteLabel}
          title={deleteLabel}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            onDelete();
          }}
          className="absolute right-1 top-1 z-10 text-[#959ca7] opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/card:opacity-100"
        >
          <Trash2 />
        </Button>
      ) : null}

      {editable && onSaveCard ? (
        <>
          <div className="flex items-center gap-1 pr-6 text-[12px] font-bold text-[#15171c]">
            {/* Drag affordance — the whole card is draggable (dnd-kit listeners live
                on the wrapper), so this grip is a visual handle to show the card moves. */}
            <GripVertical
              aria-hidden
              className="-ml-0.5 size-3.5 shrink-0 cursor-grab text-[#959ca7]"
            />
            <EditableText
              value={p.companyName}
              placeholder={companyPlaceholder ?? ''}
              autoFocus={autoFocusCompany}
              onAutoFocusConsumed={onFocusConsumed}
              onSave={(next) => onSaveCard(p.id, { companyName: next })}
              className="text-[12px] font-bold text-[#15171c]"
            />
            {isWon ? <span className="shrink-0 text-[#15171c]">✓</span> : null}
          </div>
          <div className="mt-px text-[10.5px] text-[#5b626d]">
            <EditableText
              value={p.contactName}
              placeholder={contactPlaceholder ?? ''}
              onSave={(next) => onSaveCard(p.id, { contactName: next })}
              className="text-[10.5px] text-[#5b626d]"
            />
          </div>
          <div className="text-[10.5px] text-[#959ca7]">
            <EditableText
              value={p.phone}
              placeholder={phonePlaceholder ?? ''}
              onSave={(next) => onSaveCard(p.id, { phone: next })}
              className="text-[10.5px] text-[#959ca7]"
            />
          </div>
          <div className="mt-[9px] flex items-center justify-between gap-2">
            <NicheSelect
              value={p.niche ?? p.nicheTargetName}
              placeholder="PV"
              onChange={(name) => onSaveCard(p.id, { niche: name })}
            />
            <DealValue
              value={p.dealValue}
              label={dealLabel ?? ''}
              onSave={onSaveDeal}
            />
          </div>
        </>
      ) : (
        <>
          <p className="truncate pr-6 text-[12px] font-bold text-[#15171c]">
            {p.companyName ?? p.email}
            {isWon ? <span className="text-[#15171c]"> ✓</span> : null}
          </p>
          {p.contactName?.trim() || location ? (
            <p className="mt-px truncate text-[10.5px] text-[#959ca7]">
              {p.contactName?.trim() || location}
            </p>
          ) : null}
          <div className="mt-[9px] flex items-center justify-between gap-2">
            {nicheTag ? (
              <span className="max-w-[60%] truncate rounded-[5px] border border-[#c2c7ce] px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#5b626d]">
                {nicheTag}
              </span>
            ) : (
              <span />
            )}
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {formatEuros(p.dealValue)}
            </span>
          </div>
        </>
      )}
    </div>
  );
});

// The draggable in-column card: only dims while dragging (the DragOverlay shows the
// moving copy), so the grid never reflows mid-drag.
function ProspectCard({
  p,
  onOpen,
  onSaveDeal,
  onSaveCard,
  onDelete,
  autoFocusCompany,
  onFocusConsumed,
  deleteLabel,
  dealLabel,
  companyPlaceholder,
  contactPlaceholder,
  phonePlaceholder,
}: {
  p: ProspectDto;
  onOpen: () => void;
  onSaveDeal: (dealValue: number) => void;
  onSaveCard: (id: string, patch: UpdateProspectCardDto) => void;
  onDelete: () => void;
  autoFocusCompany: boolean;
  onFocusConsumed: () => void;
  deleteLabel: string;
  dealLabel: string;
  companyPlaceholder: string;
  contactPlaceholder: string;
  phonePlaceholder: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: p.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={cn(
        'cursor-grab touch-none transition-opacity active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <CardView
        p={p}
        onSaveDeal={onSaveDeal}
        onSaveCard={onSaveCard}
        onDelete={onDelete}
        autoFocusCompany={autoFocusCompany}
        onFocusConsumed={onFocusConsumed}
        deleteLabel={deleteLabel}
        dealLabel={dealLabel}
        companyPlaceholder={companyPlaceholder}
        contactPlaceholder={contactPlaceholder}
        phonePlaceholder={phonePlaceholder}
      />
    </div>
  );
}
