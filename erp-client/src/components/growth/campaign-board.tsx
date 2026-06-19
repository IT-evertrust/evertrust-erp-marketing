'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { useCampaigns } from '@/hooks/use-campaigns';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/auth/can';
import { NicheTargets } from './niche-targets';
import { LeadScraperRun } from './lead-scraper-run';

// Reach → "Lead Scraper" tab (R.E.A.N. mockup). Pick a campaign; its niche / geo /
// sender fill the read-only criteria (the scraper inherits them from the campaign,
// exactly as the n8n Lead Satellite does), and the niche's targets — the segments
// the scraper actually runs — render below as the live, editable results surface
// (every target toggle/add/delete is a real mutation via NicheTargets). Leads the
// scraper finds attach to the selected campaign and surface in the Campaigns tab.
export function CampaignBoard() {
  const t = useTranslations('growth.reach.scraper');
  const campaigns = useCampaigns();
  const list = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first campaign once the list loads (and clear the selection if
  // the chosen campaign disappears, e.g. after a delete).
  useEffect(() => {
    if (list.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((c) => c.id === selectedId)) {
      setSelectedId(list[0]!.id);
    }
  }, [list, selectedId]);

  const selected = list.find((c) => c.id === selectedId) ?? null;

  if (campaigns.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (campaigns.isError) {
    return (
      <p className="text-sm text-destructive">
        {t('loadError', { message: campaigns.error.message })}
      </p>
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Search />}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>{t('criteriaTitle')}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('criteriaMeta')}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="scraper-campaign">{t('selectLabel')}</Label>
            <Select
              value={selectedId ?? undefined}
              onValueChange={setSelectedId}
            >
              <SelectTrigger id="scraper-campaign" className="w-full sm:max-w-md">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {list.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || c.project}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <ReadOnlyField label={t('nicheLabel')} value={selected?.nicheName ?? '—'} />
            <ReadOnlyField
              label={t('geoLabel')}
              value={
                selected
                  ? [selected.region, selected.country].filter(Boolean).join(', ') || '—'
                  : '—'
              }
            />
            <ReadOnlyField label={t('senderLabel')} value={selected?.sender ?? '—'} />
          </div>

          <Can permission="campaigns:write">
            <LeadScraperRun campaignId={selectedId ?? undefined} />
          </Can>
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('targetsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NicheTargets nicheId={selected.nicheId} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<Search />}
          title={t('pick.title')}
          description={t('pick.description')}
        />
      )}
    </div>
  );
}

// A read-only criteria field (mockup's `readonly` inputs that inherit from the
// chosen campaign). Rendered as a disabled input so it visually matches the form.
function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <Input value={value} readOnly tabIndex={-1} className="bg-muted/40" />
    </div>
  );
}
