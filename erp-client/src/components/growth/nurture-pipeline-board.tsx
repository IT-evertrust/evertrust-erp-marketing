'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Search } from 'lucide-react';
import {
  PIPELINE_STAGE_ORDER,
  type PipelineStage,
  type ProspectDto,
} from '@evertrust/shared';
import {
  useProspectsBoard,
  useUpdateProspectStage,
} from '@/hooks/use-prospects';
import { useNicheTargets } from '@/hooks/use-niche-targets';
import {
  PIPELINE_STAGE_CLASS,
  PROSPECT_STATUS_CLASS,
  PROSPECT_STATUS_LABEL,
} from '@/lib/growth-format';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

const ALL = 'all';

// The Nurture "Sales Pipeline" board: a 6-stage kanban (Interest → Lost) the team
// drags deals through by hand. Distinct from the agent-driven outreach status,
// which rides each card as a badge. Filters: company/email search, niche target,
// and a created-date range. campaignId scopes the board; the page picks it.
export function NurturePipelineBoard({
  campaignId,
  nicheId,
}: {
  campaignId: string;
  nicheId: string | null;
}) {
  const t = useTranslations('nurture');
  const [search, setSearch] = useState('');
  const [nicheTargetId, setNicheTargetId] = useState<string>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const targetsQ = useNicheTargets(nicheId, !!nicheId);
  const setStage = useUpdateProspectStage();

  // Load the whole campaign for the kanban (a high cap, not a page) so every column
  // shows its cards. Filters narrow the set + the per-column tallies server-side.
  const q = useProspectsBoard({
    campaignId,
    q: search || undefined,
    nicheTargetId: nicheTargetId === ALL ? undefined : nicheTargetId,
    createdFrom: from ? `${from}T00:00:00.000Z` : undefined,
    createdTo: to ? `${to}T23:59:59.999Z` : undefined,
    limit: 500,
  });

  const byStage = useMemo(() => {
    const map: Record<PipelineStage, ProspectDto[]> = {
      INTEREST: [],
      INTENT: [],
      CONSIDERATION: [],
      DECISION: [],
      WON: [],
      LOST: [],
    };
    for (const p of q.data?.items ?? []) map[p.pipelineStage].push(p);
    return map;
  }, [q.data]);

  const counts = q.data?.stageCounts ?? {};

  const sensors = useSensors(
    // A small activation distance so a click opens the drawer and only a real drag moves a card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id as PipelineStage | undefined;
    if (!to) return;
    const card = q.data?.items.find((p) => p.id === id);
    if (!card || card.pipelineStage === to) return;
    setStage.mutate(
      { id, patch: { pipelineStage: to } },
      {
        onSuccess: () =>
          toast.success(
            t('pipeline.movedToast', {
              name: card.companyName ?? card.email,
              stage: t(`pipeline.stages.${to}`),
            }),
          ),
        onError: (err) => toast.error(err.message ?? t('pipeline.moveError')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pipeline.filters.search')}
            className="pl-9"
          />
        </div>
        {nicheId ? (
          <Select value={nicheTargetId} onValueChange={setNicheTargetId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('pipeline.filters.allNiches')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('pipeline.filters.allNiches')}</SelectItem>
              {(targetsQ.data ?? []).map((nt) => (
                <SelectItem key={nt.id} value={nt.id}>
                  {nt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
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
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {PIPELINE_STAGE_ORDER.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                label={t(`pipeline.stages.${stage}`)}
                count={counts[stage] ?? byStage[stage].length}
                emptyLabel={t('pipeline.columnEmpty')}
              >
                {byStage[stage].map((p) => (
                  <ProspectCard key={p.id} p={p} onOpen={() => setOpenId(p.id)} />
                ))}
              </StageColumn>
            ))}
          </div>
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
  emptyLabel,
  children,
}: {
  stage: PipelineStage;
  label: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const empty = Array.isArray(children) && children.length === 0;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[16rem] flex-col gap-2 rounded-lg border border-sidebar-border bg-card/40 p-2 transition-colors',
        isOver && 'border-primary/60 bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
            PIPELINE_STAGE_CLASS[stage],
          )}
        >
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {empty ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground/70">
            {emptyLabel}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ProspectCard({ p, onOpen }: { p: ProspectDto; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: p.id });
  const location = [p.city, p.country].filter(Boolean).join(', ');
  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={cn(
        'cursor-grab touch-none rounded-md border border-sidebar-border bg-card p-2.5 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
    >
      <p className="truncate text-sm font-semibold text-foreground">
        {p.companyName ?? p.email}
      </p>
      {location ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{location}</p>
      ) : null}
      <Badge
        variant="outline"
        className={cn('mt-2 text-[10px]', PROSPECT_STATUS_CLASS[p.status])}
      >
        {PROSPECT_STATUS_LABEL[p.status]}
      </Badge>
    </div>
  );
}
