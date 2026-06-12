'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Archive, Ban, Loader2, Search } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import {
  PROSPECT_STATUS_CLASS,
  PROSPECT_STATUS_LABEL,
  PROSPECT_STATUS_ORDER,
} from '@/lib/growth-format';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

const PAGE_SIZE = 25;
const ALL = '__all__';

// The cold-outreach board for one campaign: statusCounts chips (click to filter),
// a search box, pagination, a per-row status override, and a click-to-open drawer
// with the conversation timeline. All data is real (GET /prospects/board).
export function ProspectsBoard({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<ProspectStatus | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useProspectsBoard({
    campaignId,
    status: status ?? undefined,
    q: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const data = q.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.statusCounts ?? {};
  const totalAll = PROSPECT_STATUS_ORDER.reduce(
    (sum, s) => sum + (counts[s] ?? 0),
    0,
  );
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(query.trim());
  }

  function pickStatus(next: ProspectStatus | null) {
    setPage(0);
    setStatus(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* statusCounts chips — click to filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => pickStatus(null)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            status === null
              ? 'border-foreground/30 bg-foreground/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-accent/50',
          )}
        >
          All <span className="tabular-nums">{totalAll}</span>
        </button>
        {PROSPECT_STATUS_ORDER.map((s) => {
          const n = counts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => pickStatus(s)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                status === s
                  ? PROSPECT_STATUS_CLASS[s]
                  : 'border-border text-muted-foreground hover:bg-accent/50',
              )}
            >
              {PROSPECT_STATUS_LABEL[s]}{' '}
              <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* search + status select */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={applySearch} className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email or company…"
            className="w-64 pl-8"
          />
        </form>
        <Select
          value={status ?? ALL}
          onValueChange={(v) => pickStatus(v === ALL ? null : (v as ProspectStatus))}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {PROSPECT_STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {PROSPECT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {q.isFetching ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {/* table */}
      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Could not load prospects: {q.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          {search || status
            ? 'No prospects match these filters.'
            : 'No prospects yet — the Lead Satellite populates this board as it scrapes.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last contacted</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <ProspectRow
                  key={p.id}
                  prospect={p}
                  onOpen={() => setOpenId(p.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* pagination */}
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
            {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ProspectDetailDrawer
        prospectId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

function ProspectRow({
  prospect: p,
  onOpen,
}: {
  prospect: ProspectDto;
  onOpen: () => void;
}) {
  const setStatus = useUpdateProspectStatus();

  function override(status: ProspectStatus, label: string) {
    setStatus.mutate(
      { id: p.id, patch: { status } },
      {
        onSuccess: () => toast.success(`${label} “${p.companyName || p.email}”.`),
        onError: (e) => toast.error(e.message ?? 'Could not update the status.'),
      },
    );
  }

  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <TableCell className="font-medium">{p.companyName || '—'}</TableCell>
      <TableCell className="text-muted-foreground">{p.email}</TableCell>
      <TableCell className="text-muted-foreground">
        {[p.city, p.country].filter(Boolean).join(', ') || '—'}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={PROSPECT_STATUS_CLASS[p.status]}>
          {PROSPECT_STATUS_LABEL[p.status]}
        </Badge>
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {p.lastContactedAt ? formatDateTime(p.lastContactedAt) : '—'}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Can permission="campaigns:write">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Actions for ${p.companyName || p.email}`}
                disabled={setStatus.isPending}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={p.status === 'NOT_INTERESTED'}
                onSelect={() => override('NOT_INTERESTED', 'Archived')}
              >
                <Archive />
                Mark not interested
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={p.status === 'DO_NOT_CONTACT'}
                onSelect={() => override('DO_NOT_CONTACT', 'Suppressed')}
              >
                <Ban />
                Do not contact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Can>
      </TableCell>
    </TableRow>
  );
}
