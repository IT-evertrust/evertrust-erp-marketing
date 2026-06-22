'use client';

// Render on demand, never prerendered: a gated, per-tenant surface. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
// Step 4 of R.E.A.N. — move deals through the pipeline + assist with contracts.
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Columns3, FileSignature, Inbox } from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { useRequirePermission } from '@/lib/permissions';
import { useCampaigns } from '@/hooks/use-campaigns';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ProspectsBoard } from '@/components/growth/prospects-board';
import { ContractsCard } from '@/components/growth/contracts-card';

type Tab = 'pipeline' | 'contracts';

function campaignLabel(c: CampaignDto): string {
  return c.name || c.project || c.nicheName || c.region;
}

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function NurturePage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <NurtureView />;
}

function NurtureView() {
  const tn = useTranslations('nurture');
  const campaignsQ = useCampaigns();
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);

  const [tab, setTab] = useState<Tab>('pipeline');
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // Default to the first ACTIVE campaign (or the first overall) once loaded, and
  // keep the selection valid if it disappears from the list.
  useEffect(() => {
    const first = campaigns[0];
    if (!first) return;
    if (campaignId && campaigns.some((c) => c.id === campaignId)) return;
    const active = campaigns.find((c) => c.lifecycle === 'ACTIVE');
    setCampaignId((active ?? first).id);
  }, [campaigns, campaignId]);

  const tabs = [
    {
      value: 'pipeline' as const,
      label: tn('tabs.pipeline'),
      icon: <Columns3 className="size-3.5" />,
    },
    {
      value: 'contracts' as const,
      label: tn('tabs.contracts'),
      icon: <FileSignature className="size-3.5" />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tn('title')}
        description={tn('subtitle')}
        actions={
          campaigns.length > 0 ? (
            <Select
              value={campaignId ?? undefined}
              onValueChange={setCampaignId}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder={tn('campaignPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {campaignLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      <SegmentedTabs
        tabs={tabs}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      />

      {campaignsQ.isLoading ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : campaignsQ.isError ? (
        <p className="text-sm text-destructive">
          {tn('loadError', { message: campaignsQ.error.message })}
        </p>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={tn('noCampaigns.title')}
          description={tn('noCampaigns.body')}
        />
      ) : !campaignId ? (
        <EmptyState
          icon={<Inbox />}
          title={tn('pickCampaign.title')}
          description={tn('pickCampaign.body')}
        />
      ) : tab === 'pipeline' ? (
        <ProspectsBoard campaignId={campaignId} />
      ) : (
        <ContractsCard
          filters={{ campaignId }}
          title={tn('contracts.listTitle')}
          emptyHint={tn('contracts.listEmpty')}
          showDraftForm
        />
      )}
    </div>
  );
}
