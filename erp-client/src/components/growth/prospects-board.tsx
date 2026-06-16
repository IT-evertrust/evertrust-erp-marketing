'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Archive,
  Ban,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import type { ProspectDto, ProspectStatus } from '@evertrust/shared';
import {
  useProspectsBoard,
  useUpdateProspectStatus,
} from '@/hooks/use-prospects';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Board, BoardCard, BoardColumn, type BoardTone } from '@/components/rean/board';
import { cn } from '@/lib/utils';
import { PROSPECT_STATUS_ORDER } from '@/lib/growth-format';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// Big page so the kanban shows a meaningful slice of the pipeline at once.
const PAGE_SIZE = 200;
const ALL = '__all__';

// Per-column header accent (mockup: Won = emerald, Lost-ish = rose). Maps the live
// ProspectStatus funnel onto the kit's BoardColumn tones.
const COLUMN_TONE: Record<ProspectStatus, BoardTone> = {
  NEW: 'default',
  EMAILED: 'sky',
  REPLIED: 'violet',
  INTERESTED: 'emerald',
  MEETING_SCHEDULED: 'emerald',
  RE_ENGAGED: 'amber',
  NOT_INTERESTED: 'default',
  DO_NOT_CONTACT: 'rose',
};

// The cold-outreach pipeline for one campaign, reframed as the mockup kanban
// (`.board` / `.col` / `.kcard`): one column per ProspectStatus, each card a real
// prospect with ‹ › move controls (a live status override) plus an archive /
// do-not-contact menu and click-to-open detail drawer. Search + status filter are
// preserved; data is real (GET /prospects/board, polled).
export function ProspectsBoard({ campaignId }: { campaignId: string }) {
  const t = useTranslations('marketing');
  const tn = useTranslations('nurture');
  const [status, setStatus] = useState<ProspectStatus | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useProspectsBoard({
    campaignId,
    status: status ?? undefined,
    q: search || undefined,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const counts = q.data?.statusCounts ?? {};

  // Group the page's prospects into columns. When a status filter is active only
  // that column fills; the rest render empty so the funnel shape stays legible.
  const byStatus = useMemo(() => {
    const map = {} as Record<ProspectStatus, ProspectDto[]>;
    for (const s of PROSPECT_STATUS_ORDER) map[s] = [];
    for (const p of items) (map[p.status] ??= []).push(p);
    return map;
  }, [items]);

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(query.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      {/* search + status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={applySearch} className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('prospects.searchPlaceholder')}
            className="w-64 pl-8"
          />
        </form>
        <Select
          value={status ?? ALL}
          onValueChange={(v) =>
            setStatus(v === ALL ? null : (v as ProspectStatus))
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t('prospects.allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('prospects.allStatuses')}</SelectItem>
            {PROSPECT_STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {q.isFetching ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {/* board */}
      {q.isLoading ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          {t('prospects.loadError', { message: q.error.message })}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          {search || status
            ? t('prospects.emptyFiltered')
            : t('prospects.empty')}
        </p>
      ) : (
        <Board>
          {PROSPECT_STATUS_ORDER.map((s) => (
            <BoardColumn
              key={s}
              title={t(`status.${s}`)}
              count={counts[s] ?? byStatus[s].length}
              tone={COLUMN_TONE[s]}
            >
              {byStatus[s].length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                  {tn('pipeline.columnEmpty')}
                </p>
              ) : (
                byStatus[s].map((p) => (
                  <DealCard
                    key={p.id}
                    prospect={p}
                    onOpen={() => setOpenId(p.id)}
                  />
                ))
              )}
            </BoardColumn>
          ))}
        </Board>
      )}

      <ProspectDetailDrawer
        prospectId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

// One kanban card (mockup `.kcard`): company title, location subtitle, and a
// footer with a status badge on the left + ‹ › move controls / overflow menu on
// the right. ‹ › walk the prospect through PROSPECT_STATUS_ORDER via a real
// status mutation; the menu offers archive / do-not-contact.
function DealCard({
  prospect: p,
  onOpen,
}: {
  prospect: ProspectDto;
  onOpen: () => void;
}) {
  const t = useTranslations('marketing');
  const tn = useTranslations('nurture');
  const setStatus = useUpdateProspectStatus();

  const idx = PROSPECT_STATUS_ORDER.indexOf(p.status);
  const prev = idx > 0 ? PROSPECT_STATUS_ORDER[idx - 1] : null;
  const next =
    idx >= 0 && idx < PROSPECT_STATUS_ORDER.length - 1
      ? PROSPECT_STATUS_ORDER[idx + 1]
      : null;

  function move(to: ProspectStatus | null) {
    if (!to) return;
    setStatus.mutate(
      { id: p.id, patch: { status: to } },
      {
        onSuccess: () =>
          toast.success(
            tn('pipeline.movedToast', {
              name: p.companyName || p.email,
              stage: t(`status.${to}`),
            }),
          ),
        onError: (e) => toast.error(e.message ?? t('prospects.statusError')),
      },
    );
  }

  function override(
    to: ProspectStatus,
    toastKey: 'archivedToast' | 'suppressedToast',
  ) {
    setStatus.mutate(
      { id: p.id, patch: { status: to } },
      {
        onSuccess: () =>
          toast.success(
            t(`prospects.${toastKey}`, { name: p.companyName || p.email }),
          ),
        onError: (e) => toast.error(e.message ?? t('prospects.statusError')),
      },
    );
  }

  const location = [p.city, p.country].filter(Boolean).join(', ');

  return (
    <BoardCard
      onClick={onOpen}
      title={p.companyName || p.email}
      subtitle={location || p.email}
      footer={
        <>
          {p.emailVerified ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-[10px] font-medium text-emerald-400"
            >
              {tn('pipeline.verified')}
            </Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">
              {p.followupCount > 0
                ? tn('pipeline.followups', { count: p.followupCount })
                : '—'}
            </span>
          )}
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Can permission="campaigns:write">
              <button
                type="button"
                aria-label={tn('pipeline.moveBack')}
                disabled={!prev || setStatus.isPending}
                onClick={() => move(prev ?? null)}
                className={cn(
                  'grid size-6 place-items-center rounded-md border bg-muted text-muted-foreground transition-colors',
                  'hover:border-muted-foreground/50 hover:text-foreground',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={tn('pipeline.moveForward')}
                disabled={!next || setStatus.isPending}
                onClick={() => move(next ?? null)}
                className={cn(
                  'grid size-6 place-items-center rounded-md border bg-muted text-muted-foreground transition-colors',
                  'hover:border-muted-foreground/50 hover:text-foreground',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                <ChevronRight className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    aria-label={t('prospects.rowActions', {
                      name: p.companyName || p.email,
                    })}
                    disabled={setStatus.isPending}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={p.status === 'NOT_INTERESTED'}
                    onSelect={() => override('NOT_INTERESTED', 'archivedToast')}
                  >
                    <Archive />
                    {t('prospects.markNotInterested')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={p.status === 'DO_NOT_CONTACT'}
                    onSelect={() => override('DO_NOT_CONTACT', 'suppressedToast')}
                  >
                    <Ban />
                    {t('prospects.doNotContact')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Can>
          </div>
        </>
      }
    />
  );
}
