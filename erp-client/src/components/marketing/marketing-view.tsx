'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MarketingFunnelBar } from './marketing-funnel-bar';
import { MarketingDraftReview } from './marketing-draft-review';
import { MarketingReport } from './marketing-report';
import { MarketingGrowthEngine } from './marketing-growth-engine';
import { MarketingCampaigns } from './marketing-campaigns';

// Marketing page: the whole acquisition funnel under one roof, four tabs in
// action-first order — "Growth Engine" (the arsenal sequence; AIM now launches
// from the Dashboard), "Campaigns" (deployed-campaign tracking, Drive-synced),
// "Draft review" (RAG reply drafts awaiting human approval) and "Report" (live
// Growth-Engine arsenal_runs report). Growth Engine is the default tab.
export function MarketingView() {
  const t = useTranslations('marketing');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
      />
      <MarketingFunnelBar />
      <Tabs defaultValue="growth" className="w-full">
        <TabsList>
          <TabsTrigger value="growth">{t('tabs.growth')}</TabsTrigger>
          <TabsTrigger value="campaigns">{t('tabs.campaigns')}</TabsTrigger>
          <TabsTrigger value="drafts">{t('tabs.drafts')}</TabsTrigger>
          <TabsTrigger value="report">{t('tabs.report')}</TabsTrigger>
        </TabsList>
        <TabsContent value="growth" className="mt-4">
          <MarketingGrowthEngine />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <MarketingCampaigns />
        </TabsContent>
        <TabsContent value="drafts" className="mt-4">
          <MarketingDraftReview />
        </TabsContent>
        <TabsContent value="report" className="mt-4">
          <MarketingReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
