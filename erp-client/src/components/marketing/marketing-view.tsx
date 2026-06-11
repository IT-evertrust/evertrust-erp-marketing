'use client';

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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketing"
        description="Run the Growth Engine, track what's deployed, review RAG drafts, and read the report."
      />
      <MarketingFunnelBar />
      <Tabs defaultValue="growth" className="w-full">
        <TabsList>
          <TabsTrigger value="growth">Growth Engine</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="drafts">Draft review</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
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
