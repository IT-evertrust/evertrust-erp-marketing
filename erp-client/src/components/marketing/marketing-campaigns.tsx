'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, ExternalLink, Files } from 'lucide-react';
import { type CampaignDto } from '@evertrust/shared';
import { useCampaigns, useCampaignFiles } from '@/hooks/use-campaigns';
import { useMarketingReport } from '@/hooks/use-arsenal';
import { StatTile } from '@/components/rean/stat-tile';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { AimLaunchDialog } from '@/components/growth/aim-launch-dialog';
import { RunStageButton } from '@/components/growth/run-stage-button';
import { DeleteCampaignButton } from '@/components/growth/delete-campaign-button';

// Reach → "Campaigns" tab (R.E.A.N. mockup): a "Create campaign" prompt card, five
// KPI tiles (campaigns / active / leads / replies / meetings — all REAL from the
// weekly marketing report), and the campaigns table with the mockup's columns
// (Campaign · Niche · Geo · Sender · Status · Leads). Per-campaign Leads come from
// the report funnel (null → "—" until n8n reports); every row keeps its live
// manage / details / Drive / run / delete affordances.
export function MarketingCampaigns() {
  const t = useTranslations('growth.reach.campaigns');
  const campaigns = useCampaigns();
  const report = useMarketingReport('week', null);

  const list = campaigns.data ?? [];
  const f = report.data?.funnel;

  const active = list.filter((c) => c.lifecycle === 'ACTIVE').length;
  const tiles: { key: string; value: number | null; accent: 'emerald' | 'sky' | 'violet' | 'amber' }[] = [
    { key: 'campaigns', value: list.length, accent: 'emerald' },
    { key: 'active', value: active, accent: 'emerald' },
    { key: 'leads', value: f?.leadsFound ?? null, accent: 'sky' },
    { key: 'replies', value: f?.repliesHandled ?? null, accent: 'violet' },
    { key: 'meetings', value: f?.meetingsBooked ?? null, accent: 'amber' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <StatTile
            key={tile.key}
            accent={tile.accent}
            label={t(`tiles.${tile.key}`)}
            value={
              campaigns.isLoading ? (
                <Skeleton className="h-6 w-8" />
              ) : tile.value === null ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                tile.value
              )
            }
          />
        ))}
      </div>

      {/* Create campaign prompt — the AIM launch dialog lives behind the button */}
      <Can permission="campaigns:write">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span>{t('createTitle')}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t('createMeta')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <AimLaunchDialog />
            <span className="text-xs text-muted-foreground">
              {t('createHint')}
            </span>
          </CardContent>
        </Card>
      </Can>

      {/* Campaigns table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>{t('tableTitle')}</span>
            {!campaigns.isLoading && !campaigns.isError ? (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {t('count', { count: list.length })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : campaigns.isError ? (
            <p className="text-sm text-destructive">
              {t('loadError', { message: campaigns.error.message })}
            </p>
          ) : list.length === 0 ? (
            <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col.campaign')}</TableHead>
                    <TableHead>{t('col.niche')}</TableHead>
                    <TableHead>{t('col.geo')}</TableHead>
                    <TableHead>{t('col.sender')}</TableHead>
                    <TableHead>{t('col.lifecycle')}</TableHead>
                    <TableHead className="text-right">{t('col.leads')}</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((c) => (
                    <CampaignRow key={c.id} campaign={c} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignRow({ campaign: c }: { campaign: CampaignDto }) {
  const t = useTranslations('growth.reach.campaigns');
  const tMarketing = useTranslations('marketing');
  const pill = CAMPAIGN_LIFECYCLE_BADGE[c.lifecycle];
  // Per-campaign leads from the report endpoint (REAL; "—" until n8n reports).
  const cReport = useMarketingReport('week', c.id);
  const leads = cReport.data?.funnel?.leadsFound ?? null;
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">
        <span className="truncate" title={c.project}>
          {c.name || c.project}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{c.nicheName ?? '—'}</TableCell>
      <TableCell className="text-muted-foreground">
        {[c.region, c.country].filter(Boolean).join(', ') || '—'}
      </TableCell>
      <TableCell className="text-muted-foreground">{c.sender}</TableCell>
      <TableCell>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
            pill.className,
          )}
        >
          {tMarketing(`lifecycle.${c.lifecycle}`)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {cReport.isLoading ? (
          <Skeleton className="ml-auto h-4 w-6" />
        ) : leads === null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          leads.toLocaleString()
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1.5">
          <Can permission="campaigns:write">
            <RunStageButton
              stage="LEAD_SATELLITE"
              campaignId={c.id}
              label={tMarketing('campaigns.runStage')}
              variant="outline"
              size="sm"
            />
          </Can>
          <Button variant="outline" size="sm" onClick={() => setFilesOpen(true)}>
            <Files />
            {tMarketing('common.details')}
          </Button>
          {c.driveFolderUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={c.driveFolderUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                {tMarketing('common.open')}
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/marketing/${c.id}`}>
              {t('manage')}
              <ArrowRight />
            </Link>
          </Button>
          <Can permission="campaigns:write">
            <DeleteCampaignButton campaign={c} />
          </Can>
        </div>
      </TableCell>
      <CampaignFilesDialog
        campaign={c}
        open={filesOpen}
        onOpenChange={setFilesOpen}
      />
    </TableRow>
  );
}

// Friendly file-type key from a Drive mimeType (translated at the call site).
// Returns a key from campaigns.fileType.*, or a raw mime subtype as a fallback.
function fileType(m: string | null): { key: string | null; raw?: string } {
  if (!m) return { key: 'file' };
  if (m.includes('spreadsheet')) return { key: 'sheet' };
  if (m.includes('document')) return { key: 'doc' };
  if (m.includes('presentation')) return { key: 'slides' };
  if (m.includes('folder')) return { key: 'folder' };
  if (m.includes('pdf')) return { key: 'pdf' };
  if (m.startsWith('text/')) return { key: 'text' };
  if (m.startsWith('image/')) return { key: 'image' };
  return { key: null, raw: m.split('/').pop() || undefined };
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
  const t = useTranslations('marketing');
  const q = useCampaignFiles(campaign.id, open);
  const files = q.data?.files ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('campaigns.files.title', { name: campaign.name || campaign.project })}</DialogTitle>
          <DialogDescription>
            {t('campaigns.files.description')}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {t('campaigns.files.loadError', { message: q.error.message })}
          </p>
        ) : q.data && !q.data.configured ? (
          <p className="text-sm text-muted-foreground">
            {t.rich('campaigns.files.notConnected', { code: (chunks) => <code>{chunks}</code> })}
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('campaigns.files.empty')}
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('campaigns.files.colName')}</TableHead>
                  <TableHead className="w-20">{t('campaigns.files.colType')}</TableHead>
                  <TableHead className="w-28">{t('campaigns.files.colModified')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const ft = fileType(file.mimeType);
                  const cells = (
                    <>
                      <TableCell className="font-medium">{file.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {ft.key ? t(`campaigns.fileType.${ft.key}`) : (ft.raw ?? t('campaigns.fileType.file'))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {file.modifiedTime ? timeAgo(file.modifiedTime) : '—'}
                      </TableCell>
                      <TableCell>
                        {file.webViewLink ? (
                          <ExternalLink className="size-3.5 text-muted-foreground" />
                        ) : null}
                      </TableCell>
                    </>
                  );
                  return file.webViewLink ? (
                    <TableRow
                      key={file.id}
                      className="cursor-pointer"
                      onClick={() =>
                        window.open(
                          file.webViewLink!,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                    >
                      {cells}
                    </TableRow>
                  ) : (
                    <TableRow key={file.id}>{cells}</TableRow>
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
