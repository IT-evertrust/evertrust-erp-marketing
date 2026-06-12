'use client';

import { useState } from 'react';
import { Layers, Target } from 'lucide-react';
import type { NicheListItemDto } from '@evertrust/shared';
import { useNiches } from '@/hooks/use-niche-targets';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NicheTargets } from './niche-targets';

// Niches management page: the org's niche catalog with target/campaign rollups.
// Click a niche to manage its targets (the same NicheTargets surface used on the
// campaign detail). All data is real (GET /niches, GET /niches/:id/targets).
export function NichesView() {
  const q = useNiches();
  const [selected, setSelected] = useState<NicheListItemDto | null>(null);

  const niches = q.data ?? [];
  const totalTargets = niches.reduce((s, n) => s + n.targetCount, 0);
  const totalCampaigns = niches.reduce((s, n) => s + n.campaignCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Niches"
        description="The shared niche vocabulary — segments the Growth Engine scrapes. Manage each niche's targets."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Niches"
          value={q.isLoading ? <Skeleton className="h-6 w-8" /> : niches.length}
        />
        <StatTile
          label="Targets"
          value={q.isLoading ? <Skeleton className="h-6 w-8" /> : totalTargets}
        />
        <StatTile
          label="Campaigns"
          value={q.isLoading ? <Skeleton className="h-6 w-8" /> : totalCampaigns}
        />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Could not load niches: {q.error.message}
        </p>
      ) : niches.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No niches yet"
          description="Niches are created when you launch a campaign from the Growth Engine (AIM)."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Niche</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-right">Targets</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {niches.map((n) => (
                <TableRow
                  key={n.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(n)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelected(n);
                  }}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Target className="size-4 text-muted-foreground" />
                      {n.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{n.slug}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {n.targetCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {n.campaignCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>
                  Manage the targets the arsenal scrapes for this niche.
                </DialogDescription>
              </DialogHeader>
              <NicheTargets nicheId={selected.id} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
