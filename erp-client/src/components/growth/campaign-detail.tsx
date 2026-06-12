'use client';

import Link from 'next/link';
import { ChevronLeft, ExternalLink, FolderOpen } from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { useCampaign } from '@/hooks/use-campaigns';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { CAMPAIGN_LIFECYCLE_BADGE } from '@/lib/arsenal-sequence';
import { CampaignLifecycleActions } from './campaign-lifecycle-actions';
import { NicheTargets } from './niche-targets';
import { ProspectsBoard } from './prospects-board';
import { ContractsCard } from './contracts-card';

// Campaign detail surface (route /marketing/[campaignId] — deep-linkable, mirrors
// /tenders/[id]). Overview + Targets (the niche's targets) + Prospects (the board)
// + Contracts. Lifecycle actions reuse the shared dropdown (optimistic).
export function CampaignDetail({ id }: { id: string }) {
  const { data: campaign, isLoading, isError, error } = useCampaign(id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href="/marketing"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back to Marketing
      </Link>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Could not load campaign</CardTitle>
            <CardDescription>
              {error.status === 404
                ? 'This campaign does not exist or is not in your organization.'
                : error.message}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : campaign ? (
        <CampaignDetailBody campaign={campaign} />
      ) : null}
    </div>
  );
}

function CampaignDetailBody({ campaign: c }: { campaign: CampaignDto }) {
  const badge = CAMPAIGN_LIFECYCLE_BADGE[c.lifecycle];
  const title = c.name || c.project;

  return (
    <div className="flex flex-col gap-6">
      {/* masthead */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <Badge variant="outline" className={badge.className}>
              {badge.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {c.nicheName ?? 'Niche campaign'} · {c.region}, {c.country}
          </p>
        </div>
        <CampaignLifecycleActions campaign={c} />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Field label="Project" value={c.project} />
                <Field label="Niche" value={c.nicheName} />
                <Field label="Region" value={c.region} />
                <Field label="Country" value={c.country} />
                <Field label="Sender" value={c.sender} />
                <Field label="Gmail label" value={c.gmailLabel} />
                <Field label="WhatsApp" value={c.whatsappNumber} />
                <Field
                  label="Activated"
                  value={c.activatedAt ? formatDateTime(c.activatedAt) : null}
                />
                <Field label="Created" value={formatDateTime(c.createdAt)} />
              </dl>

              {c.driveFolderUrl || c.driveFolderId ? (
                <a
                  href={
                    c.driveFolderUrl ??
                    `https://drive.google.com/drive/folders/${c.driveFolderId}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm text-sky-400 hover:underline"
                >
                  <FolderOpen className="size-4" />
                  Open Drive folder
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="targets" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Niche targets</CardTitle>
              <CardDescription>
                The segments the arsenal scrapes for this campaign&rsquo;s niche.
                Toggle, edit, or add manual targets.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NicheTargets nicheId={c.nicheId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prospects" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prospects</CardTitle>
              <CardDescription>
                The cold-outreach board for this campaign. Click a row for the
                conversation timeline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProspectsBoard campaignId={c.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <ContractsCard
                filters={{ campaignId: c.id }}
                title="Campaign contracts"
                emptyHint="No contracts generated for this campaign yet."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('truncate', !value && 'text-muted-foreground')}>
        {value || '—'}
      </dd>
    </div>
  );
}
