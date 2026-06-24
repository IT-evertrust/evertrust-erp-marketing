'use client';

// Render on demand, never prerendered: a gated, per-tenant surface. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
// Step 4 of R.E.A.N. — move deals through the pipeline + assist with contracts.
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { useRequirePermission } from '@/lib/permissions';
import { useCampaigns } from '@/hooks/use-campaigns';
import { EmptyState } from '@/components/common/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { NurturePipelineBoard } from '@/components/growth/nurture-pipeline-board';
import { ContractsCard } from '@/components/growth/contracts-card';

type Tab = 'pipeline' | 'contracts';

export function campaignLabel(c: CampaignDto): string {
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

  const TABS: ReadonlyArray<readonly [Tab, string]> = [
    ['pipeline', tn('tabs.pipeline')],
    ['contracts', tn('tabs.contracts')],
  ];

  return (
    <main className="flex flex-col gap-5 px-6 py-5 duration-300 animate-in fade-in">
      {/* Underline tab bar (matches Activate). The GrowthTopbar masthead owns the
          page title; the campaign scope selector moved into the filter rows below. */}
      <div className="flex flex-wrap gap-0 border-b border-sidebar-border">
        {TABS.map(([value, label]) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'mb-[-1px] border-b-2 px-4 py-3 text-[13px] font-bold transition',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

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
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : tab === 'pipeline' ? (
        <NurturePipelineBoard
          campaigns={campaigns}
          campaignId={campaignId}
          onCampaignChange={setCampaignId}
          nicheId={campaigns.find((c) => c.id === campaignId)?.nicheId ?? null}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Contracts are per-campaign — keep a campaign scope selector here. */}
          <Select value={campaignId ?? undefined} onValueChange={setCampaignId}>
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
          <ContractsCard
            filters={{ campaignId: campaignId ?? undefined }}
            title={tn('contracts.listTitle')}
            emptyHint={tn('contracts.listEmpty')}
            showDraftForm
          />
        </div>
      )}
    </main>
  );
}
