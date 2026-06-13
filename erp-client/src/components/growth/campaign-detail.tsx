'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('marketing');
  const { data: campaign, isLoading, isError, error } = useCampaign(id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href="/marketing"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {t('detail.back')}
      </Link>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>{t('detail.loadErrorTitle')}</CardTitle>
            <CardDescription>
              {error.status === 404
                ? t('detail.notFound')
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
  const t = useTranslations('marketing');
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
              {t(`lifecycle.${c.lifecycle}`)}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {c.nicheName ?? t('detail.nicheCampaign')} · {c.region}, {c.country}
          </p>
        </div>
        <CampaignLifecycleActions campaign={c} />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="targets">{t('detail.tabs.targets')}</TabsTrigger>
          <TabsTrigger value="prospects">{t('detail.tabs.prospects')}</TabsTrigger>
          <TabsTrigger value="contracts">{t('detail.tabs.contracts')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Field label={t('detail.field.project')} value={c.project} />
                <Field label={t('detail.field.niche')} value={c.nicheName} />
                <Field label={t('detail.field.region')} value={c.region} />
                <Field label={t('detail.field.country')} value={c.country} />
                <Field label={t('detail.field.sender')} value={c.sender} />
                <Field label={t('detail.field.gmailLabel')} value={c.gmailLabel} />
                <Field label={t('detail.field.whatsapp')} value={c.whatsappNumber} />
                <Field
                  label={t('detail.field.activated')}
                  value={c.activatedAt ? formatDateTime(c.activatedAt) : null}
                />
                <Field label={t('detail.field.created')} value={formatDateTime(c.createdAt)} />
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
                  {t('detail.openDriveFolder')}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="targets" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('detail.targetsTitle')}</CardTitle>
              <CardDescription>
                {t('detail.targetsDescription')}
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
              <CardTitle className="text-base">{t('detail.prospectsTitle')}</CardTitle>
              <CardDescription>
                {t('detail.prospectsDescription')}
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
                title={t('detail.contractsTitle')}
                emptyHint={t('detail.contractsEmpty')}
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
