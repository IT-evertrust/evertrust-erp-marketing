'use client';

import { EmailGeneratorPanel } from '../components/email-generator-panel';
import { LeadScraperPanel } from '../components/lead-scraper-panel';
import { NewCampaignModal } from '../components/new-campaign-modal';
import { ReachTabs } from '../components/reach-tabs';
import { SequenceSenderPanel } from '../components/sequence-sender-panel';
import { TemplatesEditorPanel } from '../components/templates-editor-panel';
import { useReach } from '../hooks/use-reach';

export function ReachPage() {
  const reach = useReach();

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <ReachTabs activeTab={reach.activeTab} onChange={reach.setActiveTab} />

      {reach.activeTab === 'scraper' ? (
        <LeadScraperPanel
          campaigns={reach.campaigns}
          selectedCampaignId={reach.selectedCampaignId}
          onSelectCampaign={reach.setSelectedCampaignId}
          onCreateCampaign={reach.openCampaignForm}
          selectedCampaignName={reach.selectedCampaign?.name}
          leads={reach.leads}
          loadingCampaigns={reach.loadingCampaigns}
          loadingLeads={reach.loadingLeads}
          scrape={reach.selectedScrape}
          scrapeError={reach.selectedScrapeError}
        />
      ) : null}

      {reach.activeTab === 'generator' ? (
        <EmailGeneratorPanel
          campaigns={reach.campaigns}
          selectedCampaignId={reach.selectedCampaignId}
          onSelectCampaign={reach.setSelectedCampaignId}
          selectedCampaignName={reach.selectedCampaign?.name}
          emails={reach.emails}
          loadingCampaigns={reach.loadingCampaigns}
          onSend={reach.sendRound}
          usingOrgDefault={reach.selectedCampaign?.usingOrgDefault ?? false}
        />
      ) : null}

      {reach.activeTab === 'sender' ? (
        <SequenceSenderPanel
          schedule={reach.senderSchedule}
          dailySends={reach.dailySends}
          onToggleAutoSend={reach.toggleAutoSend}
          onRunBazooka={reach.runBazooka}
          bazookaRunning={reach.bazookaRunning}
        />
      ) : null}

      {reach.activeTab === 'templates' ? <TemplatesEditorPanel /> : null}

      <NewCampaignModal
        open={reach.isCampaignFormOpen}
        onClose={reach.closeCampaignForm}
        onSubmit={reach.createCampaign}
        submitting={reach.creatingAim}
      />
    </main>
  );
}