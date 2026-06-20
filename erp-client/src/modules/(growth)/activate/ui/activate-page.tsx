'use client';

import { ActivateTabs } from '../components/activate-tabs';
import { AfterSalesAnalysisPanel } from '../components/aftersales-analysis-panel';
import { CompanyResearchPanel } from '../components/company-research-panel';
import { MeetingBookerPanel } from '../components/meeting-booker-panel';
import { useActivate } from '../hooks/use-activate';

export function ActivatePage() {
  const activate = useActivate();

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <ActivateTabs
        activeTab={activate.activeTab}
        onChange={activate.setActiveTab}
      />

      {activate.activeTab === 'booker' ? (
        <MeetingBookerPanel
          accounts={activate.accounts}
          accountId={activate.accountId}
          onSelectAccount={activate.setAccountId}
          loadingAccounts={activate.loadingAccounts}
          meetings={activate.meetings}
          loadingMeetings={activate.loadingMeetings}
        />
      ) : null}

      {activate.activeTab === 'research' ? (
        <CompanyResearchPanel
          dossiers={activate.dossiers}
          selectedDossierId={activate.selectedDossierId}
          onSelectDossier={activate.setSelectedDossierId}
          selectedDossier={activate.selectedDossier}
          loading={activate.loadingDossiers}
          generating={activate.generating}
        />
      ) : null}

      {activate.activeTab === 'aftersales' ? (
        <AfterSalesAnalysisPanel
          analyses={activate.callAnalyses}
          selectedAnalysisId={activate.selectedCallAnalysisId}
          onSelectAnalysis={activate.setSelectedCallAnalysisId}
          selectedAnalysis={activate.selectedCallAnalysis}
          loading={activate.loadingAnalyses}
          personas={activate.personas}
          selectedPersona={activate.selectedPersona}
          onSelectPersona={activate.setSelectedPersona}
          analyzing={activate.analyzing}
          onAnalyze={activate.runAnalysis}
          query={activate.analysisQuery}
          onQuery={activate.setAnalysisQuery}
          date={activate.analysisDate}
          onDate={activate.setAnalysisDate}
          onSyncReadAi={activate.syncReadAi}
          syncingReadAi={activate.syncingReadAi}
        />
      ) : null}
    </main>
  );
}
