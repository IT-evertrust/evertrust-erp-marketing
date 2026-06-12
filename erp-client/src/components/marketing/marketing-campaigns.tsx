'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, ExternalLink, Files } from 'lucide-react';
import {
  ARSENAL_STAGE_META,
  isArsenalRunOk,
  type ArsenalRunDto,
  type CampaignDto,
} from '@evertrust/shared';
import { useCampaigns, useCampaignFiles } from '@/hooks/use-campaigns';
import { useArsenalRuns, useMarketingReport } from '@/hooks/use-arsenal';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { CAMPAIGN_LIFECYCLE_BADGE, timeAgo } from '@/lib/arsenal-sequence';
import { SyncDriveButton } from '@/components/growth/sync-drive-button';
import { RunStageButton } from '@/components/growth/run-stage-button';
import { DeleteCampaignButton } from '@/components/growth/delete-campaign-button';

// Marketing → "Campaigns" tab (mockup design): KPI tiles + Sync-with-Drive + the
// launched campaigns as lifecycle-pill cards with a real per-campaign mini funnel
// and an expandable per-stage activity log.
export function MarketingCampaigns() {
  const campaigns = useCampaigns();
  const runs = useArsenalRuns();
  const report = useMarketingReport('week', null);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = campaigns.data ?? [];
  const runList = runs.data ?? [];
  const f = report.data?.funnel;

  const runsByCampaign = useMemo(() => {
    const m = new Map<string, ArsenalRunDto[]>();
    for (const r of runList) {
      if (!r.campaignId) continue;
      const arr = m.get(r.campaignId);
      if (arr) arr.push(r);
      else m.set(r.campaignId, [r]);
    }
    return m;
  }, [runList]);

  const active = list.filter((c) => c.lifecycle === 'ACTIVE').length;
  const tiles: { label: string; value: number | null }[] = [
    { label: 'Campaigns', value: list.length },
    { label: 'Active', value: active },
    { label: 'Leads', value: f?.leadsFound ?? null },
    { label: 'Replies', value: f?.repliesHandled ?? null },
    { label: 'Meetings', value: f?.meetingsBooked ?? null },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-card px-3.5 py-2.5">
            <div className="text-lg font-bold tabular-nums">
              {campaigns.isLoading ? (
                <Skeleton className="h-6 w-8" />
              ) : t.value === null ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                t.value
              )}
            </div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">
              {t.label}
            </div>
          </div>
        ))}
      </div>

      {/* header + sync */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Deployed by Growth Engine — track &amp; drill in
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The Drive folder is the source of truth — Sync archives any whose folder
            was deleted.
          </p>
        </div>
        <Can permission="campaigns:write">
          <SyncDriveButton />
        </Can>
      </div>

      {/* campaign cards */}
      {campaigns.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : campaigns.isError ? (
        <p className="text-sm text-destructive">
          Could not load campaigns: {campaigns.error.message}
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No campaigns yet — open the <span className="font-medium">Growth Engine</span>{' '}
          tab and click AIM to launch one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              runs={runsByCampaign.get(c.id) ?? []}
              open={openId === c.id}
              onToggle={() => setOpenId((p) => (p === c.id ? null : c.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  runs,
  open,
  onToggle,
}: {
  campaign: CampaignDto;
  runs: ArsenalRunDto[];
  open: boolean;
  onToggle: () => void;
}) {
  const pill = CAMPAIGN_LIFECYCLE_BADGE[c.lifecycle];
  // Per-campaign funnel from the report endpoint (REAL; null/"—" until n8n reports).
  const cReport = useMarketingReport('week', c.id);
  const cf = cReport.data?.funnel;
  const mini: { k: string; v: number | null }[] = [
    { k: 'Leads', v: cf?.leadsFound ?? null },
    { k: 'Emails', v: cf?.emailsSent ?? null },
    { k: 'Replies', v: cf?.repliesHandled ?? null },
    { k: 'Mtg', v: cf?.meetingsBooked ?? null },
  ];
  const shown = runs.slice(0, 8);
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
          <span className="truncate text-sm font-semibold" title={c.project}>
            {c.name || c.project}
          </span>
        </button>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
            pill.className,
          )}
        >
          {pill.label}
        </span>
        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          {mini.map((m) => (
            <span key={m.k}>
              {m.k}{' '}
              <b className="text-foreground tabular-nums">
                {m.v === null ? '—' : m.v}
              </b>
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Can permission="campaigns:write">
            <RunStageButton
              stage="LEAD_SATELLITE"
              campaignId={c.id}
              label="Run stage"
              variant="outline"
              size="sm"
            />
          </Can>
          {c.driveFolderId ? (
            <Button variant="outline" size="sm" onClick={() => setFilesOpen(true)}>
              <Files />
              Details
            </Button>
          ) : null}
          {c.driveFolderUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={c.driveFolderUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/marketing/${c.id}`}>
              Manage
              <ArrowRight />
            </Link>
          </Button>
          <Can permission="campaigns:write">
            <DeleteCampaignButton campaign={c} />
          </Can>
        </span>
      </div>

      {open ? (
        <div className="border-t bg-background/50 px-3.5 py-2.5">
          {shown.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              No stage activity yet — this campaign&apos;s prep stages (Lead Satellite,
              Ammo Forge) appear here once they run.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      isArsenalRunOk(r.status) ? 'bg-emerald-500' : 'bg-destructive',
                    )}
                  />
                  <span className="font-medium text-foreground">
                    {ARSENAL_STAGE_META[r.stage].label}
                  </span>
                  <span className="text-muted-foreground">{timeAgo(r.createdAt)}</span>
                  {r.detail ? (
                    <span className="truncate text-muted-foreground">· {r.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <CampaignFilesDialog
        campaign={c}
        open={filesOpen}
        onOpenChange={setFilesOpen}
      />
    </li>
  );
}

// Friendly file-type label from a Drive mimeType.
function fileType(m: string | null): string {
  if (!m) return 'File';
  if (m.includes('spreadsheet')) return 'Sheet';
  if (m.includes('document')) return 'Doc';
  if (m.includes('presentation')) return 'Slides';
  if (m.includes('folder')) return 'Folder';
  if (m.includes('pdf')) return 'PDF';
  if (m.startsWith('text/')) return 'Text';
  if (m.startsWith('image/')) return 'Image';
  return m.split('/').pop() || 'File';
}

// Details dialog: a table of every file in the campaign's Drive folder; each row
// opens that file in Drive. Files are fetched lazily (only while the dialog is open).
function CampaignFilesDialog({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: CampaignDto;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const q = useCampaignFiles(campaign.id, open);
  const files = q.data?.files ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign.name || campaign.project} — files</DialogTitle>
          <DialogDescription>
            Everything in this campaign&rsquo;s Drive folder. Click a row to open
            the file.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            Could not load files: {q.error.message}
          </p>
        ) : q.data && !q.data.configured ? (
          <p className="text-sm text-muted-foreground">
            File listing isn&rsquo;t connected yet (set <code>N8N_API_URL</code> on
            the API).
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No files in this campaign&rsquo;s folder yet.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead className="w-28">Modified</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => {
                  const cells = (
                    <>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {fileType(f.mimeType)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.modifiedTime ? timeAgo(f.modifiedTime) : '—'}
                      </TableCell>
                      <TableCell>
                        {f.webViewLink ? (
                          <ExternalLink className="size-3.5 text-muted-foreground" />
                        ) : null}
                      </TableCell>
                    </>
                  );
                  return f.webViewLink ? (
                    <TableRow
                      key={f.id}
                      className="cursor-pointer"
                      onClick={() =>
                        window.open(
                          f.webViewLink!,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                    >
                      {cells}
                    </TableRow>
                  ) : (
                    <TableRow key={f.id}>{cells}</TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
